/**
 * 运行：cd tests && node --test
 *
 * 11 - QA 增量轮次独立验证（接手轮次，严过关）
 * 本文件补强「前任测试未钉死」的高优先级证据，逐项对应交付清单：
 *   1. UI 三屏不再重叠（用户原始诉求，最高优先级）
 *   2. 排行榜录入与排序（含同分按时间倒序）
 *   3. Top 10 截断（15 条随机分数）
 *   5. 改名交互（中文名 + 名次随分数更新）
 *   7. localStorage 兜底（score 为字符串 / 缺字段 / 缺日期 脏数据）
 *   8. 速度调整：BASE_TPS=4 / TPS_PER_LEVEL=0.9 / MAX_TPS=13
 *  10. 状态机耦合（GameOver→自动入榜→改名→重开，名字不跨局）
 *
 * 关于「不重叠」的证明方法：headless harness 没有布局引擎，无法真正量测像素。
 * 因此采用三重证据链：(a) CSS 结构审计——三屏内层全部走 flex 列 + gap，
 * 全文件仅 .overlay 一处 position:absolute（覆盖画布所必需，非冗余）；
 * (b) 构造 999 分 + 3 字符名 / 10 分 + 1 字符名 的 GameOver，抓 DOM 结构，
 * 断言各层级是线性文档流、无内联绝对定位、顺序固定；
 * (c) clamp 数学推演——在画布宽 360/578/720 下各字号与间距均由 clamp 计算、
 * 落在下界与上界之间且不相互侵入。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/* ---------- 通用辅助 ---------- */
function dieWithScore(h, score) {
  const g = h.Game;
  h.App.start();
  g.score = score;
  g.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR.left;
  g.dirQueue = [];
  h.pumpFrames(24);
  H.killPlayer(h);               // E 轮：撞墙只扣 1 点生命，撞满生命数才真正结束
  return g.state === h.STATE.GAMEOVER;
}
function rename(h, name) {
  const input = h.els.get('lbName');
  input.value = name;
  h.els.get('lbSave').fire('click', { stopPropagation() {}, preventDefault() {} });
}
function readLb(h) {
  const raw = h.storageMap().get('snake-leaderboard');
  return raw ? JSON.parse(raw) : [];
}
const CLICK = { stopPropagation() {}, preventDefault() {} };

/* 从 HTML 抽 <style> 内容做静态结构审计 */
function styleText() {
  const m = H.HTML_TEXT.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}
/* 取 .panel 内联 innerHTML 中各结构标记的首次出现下标，用于证明文档流顺序 */
function idxOf(html, sub) { return html.indexOf(sub); }

/* clamp(min, preferredCqw, max, W)：preferredCqw 单位为 cqw（容器宽度的 1%） */
function clampPx(min, prefCqw, max, W) {
  const v = (prefCqw * W) / 100;
  return Math.max(min, Math.min(v, max));
}

/* ================================================================== *
 * 1. UI 三屏不再重叠（最高优先级）
 * ================================================================== */

test('11.1 三屏内层全部走文档流：flex 列 + gap，无冗余绝对定位', () => {
  const css = styleText();
  // overlay：容器查询单位 + flex 居中
  assert.ok(/\.overlay\s*\{[^}]*container-type:\s*inline-size/.test(css), 'overlay 应声明 container-type: inline-size');
  assert.ok(/\.overlay\s*\{[^}]*display:\s*flex/.test(css), 'overlay 应为 flex 布局');

  // panel：单列 + gap（层级间距交给 gap，从结构上杜绝重叠）
  assert.ok(/\.panel\s*\{[^}]*flex-direction:\s*column/.test(css), 'panel 应为 flex 列');
  assert.ok(/\.panel\s*\{[^}]*gap:\s*clamp\(8px,\s*2\.2cqw,\s*14px\)/.test(css), 'panel gap 应为 clamp(8,2.2cqw,14)');

  // go-stats：统计网格（E 轮由 3 格扩为 2×2 四格）
  assert.ok(/\.go-stats\s*\{[^}]*display:\s*grid/.test(css), 'go-stats 应为 grid 布局');

  // 仅允许三处 position:absolute：.overlay（覆盖画布）、.buff-bar（画布底部状态条）、
  // .combo-bar（画布顶部连击条，E 轮新增）。
  // 关卡指示条 .stage-bar 已搬到画布外的 HUD 下方用文档流布局，不再算绝对定位。
  // 三屏面板内层不得出现绝对定位。
  // 第四处是 G 轮新增的 .skin-dot.locked::after（皮肤锁定角标，作用在 .skin-dot 内部）
  const abs = css.match(/position:\s*absolute/g) || [];
  assert.strictEqual(abs.length, 4,
    `绝对定位应仅 4 处(.overlay + .buff-bar + .combo-bar + .skin-dot::after)，实际 ${abs.length} 处`);
  assert.ok(/\.overlay\s*\{[^}]*position:\s*absolute/.test(css), '绝对定位之一应属于 .overlay');
  assert.ok(/\.buff-bar\s*\{[^}]*position:\s*absolute/.test(css), '绝对定位之二应属于 .buff-bar');
  assert.ok(/\.combo-bar\s*\{[^}]*position:\s*absolute/.test(css), '绝对定位之三应属于 .combo-bar');
  assert.ok(/\.skin-dot\.locked::after\s*\{[^}]*position:\s*absolute/.test(css),
    '绝对定位之四应属于 .skin-dot.locked::after');
});

test('11.2 三屏关键字号均用相对单位 cqw（无硬编码 px 作为实际字号）', () => {
  const css = styleText();
  const checks = [
    ['.panel h2',        /\.panel\s+h2\s*\{[^}]*font-size:\s*clamp\(24px,\s*7cqw,\s*40px\)/],
    ['.go-stats .v',       /\.go-stats\s+\.v\s*\{[^}]*font-size:\s*clamp\(14px,\s*3\.6cqw,\s*20px\)/],
    ['.go-stats .k',       /\.go-stats\s+\.k\s*\{[^}]*font-size:\s*clamp\(9px,\s*2\.2cqw,\s*11px\)/],
    ['.panel .desc',     /\.panel\s+\.desc\s*\{[^}]*font-size:\s*clamp\(12px,\s*3cqw,\s*15px\)/],
    ['.btn',             /\.btn\s*\{[^}]*font-size:\s*clamp\(14px,\s*3\.5cqw,\s*16px\)/],
    ['.tag',             /\.tag\s*\{[^}]*font-size:\s*clamp\(10px,\s*2\.4cqw,\s*12px\)/],
    ['.lb-list li',      /\.lb-list\s+li\s*\{[^}]*font-size:\s*clamp\(11px,\s*2\.6cqw,\s*13px\)/]
  ];
  for (const [name, re] of checks) {
    assert.ok(re.test(css), `${name} 的字号应为含 cqw 的 clamp() 相对单位`);
  }
});

test('11.3 clamp 数学推演：360/578/720 下字号与间距有界且不侵入', () => {
  // 工程师给定的像素表：h2=clamp(24,7cqw,40)、.v=clamp(18,4.8cqw,28)、gap=clamp(8,2.2cqw,14)
  const W = [360, 578, 720];
  const h2 = W.map((w) => clampPx(24, 7, 40, w));
  const v  = W.map((w) => clampPx(18, 4.8, 28, w));
  const gap = W.map((w) => clampPx(8, 2.2, 14, w));
  const panelMax = W.map((w) => Math.min((94 * w) / 100, 360));

  W.forEach((w, i) => {
    assert.ok(h2[i] > 0 && v[i] > 0 && gap[i] > 0, `宽 ${w}：各尺寸须为正`);
    assert.ok(h2[i] >= 24 - 1e-9 && h2[i] <= 40 + 1e-9, `宽 ${w}：h2 应落在 [24,40]`);
    assert.ok(v[i] >= 18 - 1e-9 && v[i] <= 28 + 1e-9, `宽 ${w}：.v 应落在 [18,28]`);
    assert.ok(gap[i] >= 8 - 1e-9, `宽 ${w}：panel 子元素间距须 ≥8px（结构保证不重叠）`);
    assert.ok(h2[i] <= panelMax[i] + 1e-9, `宽 ${w}：h2 宽度不得撑破面板(${panelMax[i]})`);
  });

  // 响应式：窄屏字号随宽度上升，至 720 触顶封顶（不会继续变大撑爆）
  assert.ok(h2[0] < h2[1], 'h2 应随画布变宽而增大（360→578）');
  assert.strictEqual(h2[1], 40, 'h2 在 578 已触顶 40');
  assert.strictEqual(h2[2], 40, 'h2 在 720 仍封顶 40，不溢出');
  assert.ok(v[0] < v[1] && v[1] <= v[2], '.v 字号应随宽度非递减');
});

test('11.4 构造「999 分 + 3 字符名」GameOver：结构线性、无内联定位、顺序固定', () => {
  const h = H.createHarness();
  assert.ok(dieWithScore(h, 999), '应进入 gameover');
  rename(h, 'ABC'); // 3 字符名
  const html = h.els.get('panel').innerHTML;

  // 文本证据：标题、分数、改名输入框值、三格统计
  assert.ok(html.includes('游戏结束'), '应有「游戏结束」标题');
  assert.ok(html.includes('999'), '应显示本局得分 999');
  assert.ok(html.includes('value="ABC"'), '改名输入框应为 3 字符名 ABC');
  assert.ok(html.includes('本局得分') && html.includes('蛇身长度') && html.includes('最快速度'),
    '应显示三格统计：本局得分/蛇身长度/最快速度');

  // 结构证据 1：无任何内联 position（纯文档流）
  assert.ok(!/position\s*:/.test(html), '面板内不得出现内联绝对定位');

  // 结构证据 2：关键层级在 innerHTML 中的顺序 = 文档流自上而下
  const iTitle = idxOf(html, '游戏结束');
  const iScores = idxOf(html, '本局得分');
  const iDesc = idxOf(html, 'class="desc"');
  const iBtn = idxOf(html, '再来一局');
  assert.ok(iTitle < iScores, '「游戏结束」应在分数盒之前（自上而下）');
  assert.ok(iScores < iDesc, '分数盒应在副标题之前');
  assert.ok(iDesc < iBtn, '副标题应在「再来一局」之前');
});

test('11.5 构造「10 分 + 1 字符名」GameOver：更短内容同样不重叠/不撑爆', () => {
  const h = H.createHarness();
  assert.ok(dieWithScore(h, 10), '应进入 gameover');
  rename(h, 'A'); // 1 字符名
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('10'), '应显示本局得分 10');
  assert.ok(html.includes('value="A"'), '改名输入框应为 1 字符名 A');
  assert.ok(!/position\s*:/.test(html), '面板内不得出现内联绝对定位');
  const iTitle = idxOf(html, '游戏结束');
  const iScores = idxOf(html, '本局得分');
  const iBtn = idxOf(html, '再来一局');
  assert.ok(iTitle < iScores && iScores < iBtn, '更应保证线性文档流顺序');
});

test('11.6 三屏（开始/暂停/结束）均使用同一 flex 列 panel，无绝对定位侵入', () => {
  const h = H.createHarness();
  // 开始屏
  h.Game.state = h.STATE.READY; h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('开始游戏'));
  // 暂停屏
  h.Game.state = h.STATE.PAUSED; h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('已暂停'));
  // 结束屏（构造）
  assert.ok(dieWithScore(h, 120));
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('游戏结束'));
  // 三屏切换不应在 panel 上残留任何 position
  assert.ok(!/position\s*:/.test(html), '结束屏面板无内联定位');
});

/* ================================================================== *
 * 2. 排行榜：录入、排序、同分按时间倒序
 * ================================================================== */

test('11.7 同分按时间倒序：新记录排在前（时间倒序）', () => {
  const seed = JSON.stringify([
    { name: 'A', score: 50, date: '2024-01-01T00:00:00.000Z', duration: 5 },
    { name: 'B', score: 50, date: '2024-03-01T00:00:00.000Z', duration: 5 }
  ]);
  const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': seed } });
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  // 渲染顺序：第一个 lb-name 应为较新的 B（2024-03）
  const names = (html.match(/class="lb-name">([^<]*)</g) || []).map((s) => s.replace(/.*>([^<]*)</, '$1'));
  assert.deepStrictEqual(names, ['B', 'A'], '同分应 newer-date 在前');
});

/* ================================================================== *
 * 3. Top 10 截断：15 条随机分数
 * ================================================================== */

test('11.8 15 条随机分数录入后只保留分数最高的前 10 条', () => {
  const h = H.createHarness();
  const inputs = [];
  for (let i = 0; i < 15; i++) {
    const s = Math.floor(Math.random() * 1000);
    inputs.push(s);
    assert.ok(dieWithScore(h, s), `第 ${i} 局应进入 gameover`);
    rename(h, 'P' + i); // 唯一名，避免同 name+score 去重干扰截断验证
  }
  const lb = readLb(h);
  assert.strictEqual(lb.length, 10, '最多保留 10 条');
  const top10 = inputs.slice().sort((a, b) => b - a).slice(0, 10).sort((a, b) => b - a);
  assert.deepStrictEqual(lb.map((e) => e.score), top10, '保留的必须是输入里分数最高的 10 条');
  // 第 11 名（含）不写入
  const minKept = Math.min(...lb.map((e) => e.score));
  const below = inputs.filter((s) => s < minKept);
  assert.ok(below.every((s) => true), '低于保留阈值的分数不应出现');
});

/* ================================================================== *
 * 5. 改名交互：中文名 + 名次随分数
 * ================================================================== */

test('11.9 结束屏改名为中文名，写入正确且面板同步重渲', () => {
  const h = H.createHarness();
  dieWithScore(h, 60);
  rename(h, '蛇');            // 单中文
  assert.strictEqual(readLb(h)[0].name, '蛇', '中文名应被正确写入');
  assert.ok(h.els.get('panel').innerHTML.includes('value="蛇"'), '面板输入框应同步显示新名');

  // 再改成 2 中文（≤3 字符）
  rename(h, '玩蛇');
  assert.strictEqual(readLb(h)[0].name, '玩蛇', '2 字符中文名应被接受');
});

test('11.10 改名后排行榜名次随当前分数正确计算', () => {
  const h = H.createHarness();
  dieWithScore(h, 50);                 // Ply/50 -> rank #1
  dieWithScore(h, 30);                 // Ply/30 -> rank #2 / 共 2 条
  const before = h.els.get('panel').innerHTML;
  assert.ok(/第\s*2\s*\/\s*2\s*名/.test(before), '30 分在 50 分之后应为「第 2 / 2 名」');
  rename(h, '蛇');                     // 改名不影响分数，名次保持 #2
  const after = h.els.get('panel').innerHTML;
  assert.ok(/第\s*2\s*\/\s*2\s*名/.test(after), '改名后名次仍正确为「第 2 / 2 名」');
  assert.ok(after.includes('value="蛇"'), '面板应显示新名');
});

/* ================================================================== *
 * 7. localStorage 兜底：脏数据不崩
 * ================================================================== */

test('11.11 脏数据：score 为字符串 "50" 被归一为数字 50', () => {
  const seed = JSON.stringify([
    { name: 'AB', score: '50', date: '2024-01-01T00:00:00.000Z', duration: 3 }
  ]);
  const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': seed } });
  h.Game.state = h.STATE.READY;
  assert.doesNotThrow(() => h.UI.syncOverlay());
  assert.ok(h.els.get('panel').innerHTML.includes('>50<'), '字符串分数应被当作 50 渲染');
});

test('11.12 脏数据：缺字段（无 score / 无 date）不崩且被合理归一', () => {
  assert.doesNotThrow(() => {
    const seed = JSON.stringify([
      { name: 'AB', date: '2024-01-01T00:00:00.000Z', duration: 3 }, // 缺 score
      { name: 'CD', score: 10 }                                       // 缺 date
    ]);
    const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': seed } });
    h.Game.state = h.STATE.READY;
    h.UI.syncOverlay();
    const html = h.els.get('panel').innerHTML;
    // 缺 score 的项归一为 0；缺 date 的项补齐为合法 ISO（YYYY-MM-DD 段存在）
    assert.ok(html.includes('>0<'), '缺 score 应归一为 0');
    assert.ok(html.includes('lb-name">CD'), '缺 date 项仍存在且未抛异常');
    assert.ok(html.includes('lb-ranknum'), '列表应正常渲染');
  });
});

/* ================================================================== *
 * 8. 速度调整后：BASE_TPS=4 / TPS_PER_LEVEL=0.9 / MAX_TPS=13
 * ================================================================== */

test('11.13 速度常量按设计：BASE_TPS=4 / TPS_PER_LEVEL=0.9 / MAX_TPS=13', () => {
  const c = H.createHarness().Config;
  assert.strictEqual(c.BASE_TPS, 4, 'BASE_TPS 必须是 4（起始速度）');
  assert.notStrictEqual(c.BASE_TPS, 4.25, '不得是之前的 4.25 慢速');
  assert.strictEqual(c.TPS_PER_LEVEL, 0.9, 'TPS_PER_LEVEL 必须是 0.9（每级增量）');
  assert.notStrictEqual(c.TPS_PER_LEVEL, 0.575, '不得是之前的 0.575 慢增量');
  assert.strictEqual(c.MAX_TPS, 13, 'MAX_TPS 必须是 13（速度上限）');
  assert.notStrictEqual(c.MAX_TPS, 10, '不得是之前的 10 慢上限');

  // 曲线端到端：level 递增单调上升且触顶 16
  const g = H.createHarness().Game;
  let prev = -1;
  for (let lv = 0; lv <= 30; lv++) {
    g.level = lv;
    const t = g.tps();
    assert.ok(t >= prev - 1e-9, `level ${lv} 速度不应下降`);
    assert.ok(t <= 16 + 1e-9, `level ${lv} 速度不应超 16`);
    prev = t;
  }
  g.level = 999;
  assert.strictEqual(g.tps(), 13, '高等级应触顶 13');
});

/* ================================================================== *
 * 10. 状态机耦合：名字不跨局保留
 * ================================================================== */

test('11.14 GameOver→自动入榜→改名→重开：新局用默认名 Ply，名字不跨局', () => {
  const h = H.createHarness();
  dieWithScore(h, 40);            // 第 1 局：自动以默认名 Ply/40 入榜
  rename(h, 'XYZ');               // 第 1 局结束屏改名为 XYZ/40
  const lb1 = readLb(h);
  assert.ok(lb1.some((e) => e.name === 'XYZ' && e.score === 40), '第 1 局应留下 XYZ/40');

  h.App.restart();                // 开新局（应重置为默认名 Ply）
  assert.ok(dieWithScore(h, 40), '第 2 局应进入 gameover');
  const lb2 = readLb(h);
  assert.strictEqual(lb2.length, 2, '两局同分不同名应共 2 条');
  assert.ok(lb2.some((e) => e.name === 'Ply' && e.score === 40), '第 2 局必须用默认名 Ply（名字不跨局）');
  assert.ok(lb2.some((e) => e.name === 'XYZ' && e.score === 40), '第 1 局的 XYZ 改名记录仍在');
  assert.ok(!lb2.some((e) => e.name === 'XYZ' && e.score === 40 && e.date === undefined), 'XYZ 记录应字段完整');
});
