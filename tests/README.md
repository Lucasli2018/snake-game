# 测试套件

对 `../index.html`（单文件贪吃蛇）的自动化验证。

## 运行

```bash
cd tests && node --test
```

> 必须从 `tests` 目录运行。在项目根运行 `node --test` 会扫描到无关目录。
> 需要 Node 18+（用了内置 `node:test`）。

## 当前结果

```
# tests 167
# pass  167
# fail    0
```

第 1 轮报出的 P1 / P2 / P3a 均已修复并回归通过（第 2 轮，连跑 3 次全绿）。
`09-fix-regression.test.js` 专门把这三处修复后的行为永久钉死。

### 第 1 轮曾报出的缺陷（已修）

| 用例 | 级别 | 说明 |
| --- | --- | --- |
| `04.14` | **P1** | 游戏中按空格无法暂停（`primaryAction()` 缺 PLAYING 分支，但 README 与页脚都宣称可以） |
| `04.11` | **P2** | 时间累加器无上限，持续低帧率下无限累积欠账 |

### 维持现状（已与团队确认）

| 项 | 说明 |
| --- | --- |
| P3b | 暂停时粒子 / 飘字 / 震屏仍在推进。纯观感问题，且被暂停遮罩（半透明 + 模糊）遮住，影响极小。`08.18` 主动断言了这一现状，改动前需同步调整该断言方向。 |

## 目录

| 文件 | 覆盖点 |
| --- | --- |
| `harness.js` | 测试脚手架：从 `index.html` 抽出内联脚本，放进 Node `vm` + 一套最小 DOM/Canvas/WebAudio/rAF 替身里**真跑源码** |
| `01-direction-queue.test.js` | 反向自杀防护：340 种按键序列穷举 + 3 万次模糊测试 + 端到端按键 |
| `02-food.test.js` | 食物生成：5000 次随机零重叠、满盘兜底、哈密顿路径验证通关分支可达 |
| `03-collision.test.js` | 碰撞判定：四面墙、咬自己、追尾合法、死因文案、3 万步一致性 |
| `04-pause-resume.test.js` | 暂停恢复与累加器：dt clamp、visibilitychange/blur、单帧步数上限 |
| `05-speed-curve.test.js` | 速度曲线：`min(5+1.15L, 16)` 单调性与上限（level 9=15.35、level 10 触顶 16）、每 100 分升级 |
| `06-storage.test.js` | localStorage 兜底：undefined / 抛异常 / 脏数据 |
| `07-static.test.js` | 静态检查：零外链、无 console、语法、标签配平 |
| `08-integration.test.js` | 集成压力：2 万帧真实主循环、resize、音效、触摸、插值自洽 |
| `09-fix-regression.test.js` | 修复回归：P1 空格暂停、P2 累加器封顶、P3a 蛇头朝向兜底；含一条脚手架自身正确性用例（`09.4`） |
| `10-leaderboard.test.js` | 排行榜：三屏渲染 / 入榜 / 排序 / 改名 / 清空二次确认 / 隐私模式 |
| `11-qa-verification.test.js` | QA 独立验证：UI 重排结构、脏数据兜底、状态机耦合、速度常量反证 |

## 设计说明

- **跑的是源码，不是副本。** `harness.js` 用正则从 `index.html` 抽 `<script>`，
  只在 IIFE 结尾注入一行 `globalThis.__EXPORT__ = {...}` 用于导出内部对象，
  **其余一个字符都不改**。所以断言对源码有效。
- **替身做了严格校验。** 例如 WebAudio 替身会在 `exponentialRampToValueAtTime(0)`
  或传入 NaN 时抛错（对齐浏览器规范），Canvas 替身会在属性被赋非有限数时抛错。
- **能跑的都真跑。** DOM/Canvas 部分不是"看代码推演"，而是用替身真实执行，
  所以 `ReferenceError`、拼写错误、状态机错乱都会直接暴露。
- **`innerHTML` 会重建子树。** 给 `panel.innerHTML` 赋值后，其中的 `id` 对应的是
  **全新节点**，`harness.js` 的 `registerIdsFromHtml` 必须无条件覆盖 registry。
  若改成"按 id 缓存复用"，`ovBtn` 上会叠加多个 click 监听，一次点击触发 N 次
  `primaryAction()`。`09.4` 专门守着这条。
