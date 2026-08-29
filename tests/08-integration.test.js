/**
 * 运行：cd tests && node --test
 *
 * 08 - 集成 / 压力 / 边界
 * 覆盖：
 *   - 走真实主循环长时间游玩（含吃食物、升级、死亡、重开）不抛异常
 *   - resize / orientationchange / 各种 dpr 与舞台尺寸
 *   - 音效全路径（AudioContext 存在 / 不存在）
 *   - 遮罩按钮、音效按钮、R 重开、触摸
 *   - 渲染插值的数据自洽性
 *   - 代码审查中发现的若干边角问题（已标注严重级别）
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const KEY_OF = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** 一格一格推进，直到恰好又发生 n 个 tick */
function pumpUntilTick(h, n) {
  const target = h.tickCount() + n;
  let guard = 0;
  while (h.tickCount() < target && guard++ < 2000) h.pump();
}

/* ================================================================== *
 * 1. 长时间真实游玩
 * ================================================================== */
test('08.1 走真实主循环玩 20000 帧（含吃食物/升级/死亡/重开），全程不抛异常', () => {
  const h = H.createHarness();
  h.startPlaying();

  let deaths = 0;
  let restarts = 0;
  let maxLevel = 0;
  let maxLen = 0;

  for (let i = 0; i < 20000; i++) {
    if (h.Game.state === h.STATE.GAMEOVER) {
      deaths++;
      h.clickPanelBtn();                    // 点击"再来一局"
      restarts++;
      assert.strictEqual(h.Game.state, h.STATE.PLAYING, '点击再来一局后应重新开局');
    }
    // 用"会朝食物走"的驱动，否则蛇只会原地打转，永远升不了级
    if (i % 7 === 0) h.key(KEY_OF[H.autoPickDir(h, true)]);
    h.pump();
    maxLevel = Math.max(maxLevel, h.Game.level);
    maxLen = Math.max(maxLen, h.Game.snake.length);
    assert.ok(h.App.alpha >= 0 && h.App.alpha <= 1, `第 ${i} 帧 alpha 越界：${h.App.alpha}`);
  }

  assert.ok(deaths > 0, '2 万帧里应该至少死过一次');
  // 慢速下 tick 数减半，20000 帧内地吃到的食物可能不足 10 颗（level 需 floor(score/100)），
  // 故用「蛇身变长」证明确实吃到过食物；升级曲线由 05 单独验证。
  assert.ok(maxLen > h.Config.START_LEN, `2 万帧里应该吃到过食物（蛇最长 ${maxLen}，最高等级 ${maxLevel}）`);
  assert.deepStrictEqual(h.consoleLog, [], '运行期出现了 console 输出');
});

test('08.2 长时间游玩中蛇身始终自洽（无重叠、无脱节、不出界）', () => {
  const h = H.createHarness();
  h.startPlaying();
  const { COLS, ROWS } = h.Config;

  for (let i = 0; i < 10000; i++) {
    if (h.Game.state === h.STATE.GAMEOVER) h.key('r');
    if (i % 5 === 0) h.key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][(Math.random() * 4) | 0]);
    h.pump();

    assert.ok(!H.hasDuplicateCells(h.Game.snake), `第 ${i} 帧蛇身重叠`);
    assert.ok(H.isContiguous(h.Game.snake), `第 ${i} 帧蛇身脱节`);
    for (const s of h.Game.snake) {
      assert.ok(s.x >= 0 && s.x < COLS && s.y >= 0 && s.y < ROWS,
        `第 ${i} 帧蛇身出界 (${s.x},${s.y})`);
    }
  }
});

/* ================================================================== *
 * 2. 尺寸自适应
 * ================================================================== */
test('08.3 各种舞台尺寸下 resize 都能算出合法的正方形画布', () => {
  for (const size of [120, 180, 200, 240, 360, 600, 900, 1600]) {
    const h = H.createHarness({ stageSize: size });
    assert.doesNotThrow(() => h.Renderer.resize(), `舞台 ${size}px 时 resize 抛异常`);
    assert.ok(h.Renderer.size >= 200, `舞台 ${size}px 时画布过小：${h.Renderer.size}`);
    assert.ok(Number.isFinite(h.Renderer.cell) && h.Renderer.cell > 0, 'cell 非法');
    assert.ok(h.Renderer.dpr >= 1 && h.Renderer.dpr <= 2, 'dpr 未做上限处理');

    const cw = parseFloat(h.els.get('game').style.width);
    const chh = parseFloat(h.els.get('game').style.height);
    assert.strictEqual(cw, chh, `舞台 ${size}px 时画布不是正方形（${cw} x ${chh}）`);
    assert.strictEqual(h.els.get('game').width, Math.floor(h.Renderer.size * h.Renderer.dpr),
      'canvas.width 未按 dpr 放大');
  }
});

test('08.4 各种 devicePixelRatio 下画布尺寸正确（dpr 上限为 2）', () => {
  for (const dpr of [1, 1.5, 2, 3, 4]) {
    const h = H.createHarness({ dpr });
    assert.ok(h.Renderer.dpr <= 2, `dpr=${dpr} 时未做上限裁剪，实际 ${h.Renderer.dpr}`);
    assert.strictEqual(h.els.get('game').width, Math.floor(h.Renderer.size * h.Renderer.dpr));
  }
});

test('08.5 resize / orientationchange 事件触发后重绘不抛异常', () => {
  const h = H.createHarness();
  h.startPlaying();
  assert.doesNotThrow(() => h.winEvent('resize'), 'resize 事件处理抛异常');
  assert.doesNotThrow(() => h.flushTimers(), 'resize 的防抖定时器回调抛异常');
  assert.doesNotThrow(() => h.winEvent('orientationchange'), 'orientationchange 抛异常');
  assert.doesNotThrow(() => h.flushTimers(), 'orientationchange 的定时器回调抛异常');
  assert.doesNotThrow(() => h.pumpFrames(10), 'resize 后继续渲染抛异常');
});

test('08.6 无 ResizeObserver 的旧浏览器不会崩（已做 typeof 判断）', () => {
  const h = H.createHarness({ resizeObserver: false });
  assert.strictEqual(h.Game.state, h.STATE.READY, '缺少 ResizeObserver 时仍应正常启动');
  assert.doesNotThrow(() => h.startPlaying());
  assert.doesNotThrow(() => h.pumpFrames(20));
});

/* ================================================================== *
 * 3. 音效
 * ================================================================== */
test('08.7 有 AudioContext 时，全部音效路径都不抛异常', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.Sfx.unlock();
  assert.ok(h.Sfx.ctx, '应成功创建 AudioContext');

  assert.doesNotThrow(() => {
    h.Sfx.start();
    for (let lv = 0; lv <= 30; lv++) h.Sfx.eat(lv);
    h.Sfx.crash();
    h.Sfx.record();
    h.Sfx.pause(true);
    h.Sfx.pause(false);
    h.Sfx.noise(0.28, 0.12, 0.01);
  });
});

test('08.8 浏览器不支持 AudioContext 时静默降级，不影响游戏', () => {
  const h = H.createHarness({ audio: false });
  h.startPlaying();
  assert.doesNotThrow(() => h.Sfx.unlock(), '无 AudioContext 时 unlock 抛异常');
  assert.strictEqual(h.Sfx.ctx, null);
  assert.doesNotThrow(() => {
    h.Sfx.start(); h.Sfx.eat(1); h.Sfx.crash(); h.Sfx.record();
  });
  assert.doesNotThrow(() => h.pumpFrames(50), '无音频时主循环仍应正常');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
});

test('08.9 吃到食物 / 撞毁时会自动触发音效（走主循环真实路径）', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.Sfx.unlock();
  const ctx = h.Sfx.ctx;

  // 吃食物
  const head = h.Game.snake[0];
  h.Game.food = { x: head.x + h.Game.dir.x, y: head.y + h.Game.dir.y };
  const before = ctx.nodesCreated;
  pumpUntilTick(h, 1);
  assert.ok(ctx.nodesCreated > before, '吃到食物应创建音频节点');

  // 撞墙
  h.Game.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  h.Game.prevSnake = h.Game.snake.map((c) => ({ x: c.x, y: c.y }));
  h.Game.dir = h.DIR.left;
  h.Game.dirQueue = [];
  const before2 = ctx.nodesCreated;
  h.pumpFrames(24);
  assert.strictEqual(h.Game.state, h.STATE.GAMEOVER);
  assert.ok(ctx.nodesCreated > before2, '撞毁应播放音效');
});

/* ================================================================== *
 * 4. 渲染插值的数据自洽性
 * ================================================================== */
test('08.10 插值数据自洽：prevSnake 与 snake 的每一节最多相差 1 格', () => {
  const h = H.createHarness();
  h.startPlaying();

  for (let step = 0; step < 200; step++) {
    if (h.Game.state === h.STATE.GAMEOVER) h.key('r');
    h.key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][(Math.random() * 4) | 0]);
    pumpUntilTick(h, 1);

    const s = h.Game.snake;
    const p = h.Game.prevSnake;
    // 变长时 prevSnake 比 snake 少一节，这是预期的
    assert.ok(p.length === s.length || p.length === s.length - 1,
      `第 ${step} 步：prevSnake(${p.length}) 与 snake(${s.length}) 长度关系异常`);
    for (let i = 0; i < p.length; i++) {
      const d = Math.abs(s[i].x - p[i].x) + Math.abs(s[i].y - p[i].y);
      assert.ok(d <= 1, `第 ${step} 步第 ${i} 节从 prev 到 cur 跳了 ${d} 格，插值会拉丝`);
    }
    assert.doesNotThrow(() => h.Renderer.render(0.5), `第 ${step} 步渲染抛异常`);
  }
});

test('08.11 变长（吃到食物）那一 tick 的插值数据同样自洽', () => {
  const h = H.createHarness();
  h.startPlaying();
  // 本测试只验证「吃食物变长 + 插值自洽」，关掉闯关模式以避免第 4 颗触发关卡推进
  h.Game.stageMode = false;
  for (let n = 0; n < 30; n++) {
    const head = h.Game.snake[0];
    const d = h.Game.dir;
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (nx < 0 || ny < 0 || nx >= h.Config.COLS || ny >= h.Config.ROWS) break;
    h.Game.food = { x: nx, y: ny };
    const lenBefore = h.Game.snake.length;
    assert.strictEqual(h.Game.tick(), 'eat');
    assert.strictEqual(h.Game.snake.length, lenBefore + 1, '吃到食物应增长 1 节');
    assert.strictEqual(h.Game.prevSnake.length, lenBefore, '变长时 prevSnake 应比 snake 少 1 节');
    assert.doesNotThrow(() => h.Renderer.render(0.5), '变长那一帧渲染抛异常');
  }
});

/* ================================================================== *
 * 5. UI 交互
 * ================================================================== */
test('08.12 各状态下点击遮罩的行为正确', () => {
  const h = H.createHarness();

  // READY -> 开始
  assert.strictEqual(h.Game.state, h.STATE.READY);
  h.clickOverlay();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  // 暂停后 PLAYING 状态下遮罩是隐藏的，直接调 pause 再点
  h.App.pause();
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);
  h.clickOverlay();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  // gameover -> 重开
  h.Game.state = h.STATE.GAMEOVER;
  h.UI.syncOverlay();
  h.clickOverlay();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
});

test('08.13 R 键在任意状态下都能重开', () => {
  const h = H.createHarness();
  const states = [h.STATE.READY, h.STATE.PLAYING, h.STATE.PAUSED, h.STATE.GAMEOVER];
  for (const s of states) {
    h.Game.state = s;
    h.Game.score = 500;
    h.Game.snake = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
    h.key('r');
    assert.strictEqual(h.Game.state, h.STATE.PLAYING, `${s} 状态下按 R 应重开`);
    assert.strictEqual(h.Game.score, 0, '重开应清零得分');
    assert.strictEqual(h.Game.snake.length, h.Config.START_LEN, '重开应恢复初始蛇长');
    assert.strictEqual(h.App.accumulator, 0, '重开应清空累加器');
  }
});

test('08.14 重开会保留最高分，但清零本局数据', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.Game.score = 300;
  h.Game.gameOver();
  assert.strictEqual(h.Game.best, 300);

  h.key('r');
  assert.strictEqual(h.Game.best, 300, '重开不应清掉最高分');
  assert.strictEqual(h.Game.score, 0);
  assert.strictEqual(h.Game.level, 0);
  assert.strictEqual(h.Game.win, false);
  assert.strictEqual(h.Game.deathReason, '');
  assert.strictEqual(h.Game.dirQueue.length, 0);
});

test('08.15 触摸：轻点开始、滑动转向、轻点暂停、微小抖动不转向', () => {
  const h = H.createHarness();
  assert.strictEqual(h.Game.state, h.STATE.READY);

  h.tap();                                   // 轻点开始
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, '轻点应能开始游戏');

  // 微小抖动（<24px）不应改变方向（不转向）；在 PLAYING 态会被判为轻点 -> 暂停
  h.swipe(5, 5);
  assert.strictEqual(h.Game.dirQueue.length, 0, '微小抖动不应产生方向输入');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED, 'PLAYING 中轻点（含微小抖动）应暂停');

  // 暂停态轻点遮罩 -> 继续游戏
  h.els.get('overlay').fire('click', {});
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, '暂停态轻点遮罩应继续游戏');

  // 明确滑动应转向
  h.swipe(0, -80);
  assert.strictEqual(h.Game.dirQueue.length, 1, '明确滑动应产生方向输入');
});

test('08.16 音效按钮不影响游戏进行', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (let i = 0; i < 6; i++) {
    h.clickSound();
    assert.ok(h.Game.state === h.STATE.PLAYING, '切换音效不应改变游戏状态');
  }
  assert.doesNotThrow(() => h.pumpFrames(30));
});

/* ================================================================== *
 * 6. 代码审查发现的边角问题
 * ================================================================== */
test('08.17 【代码审查 P3】drawHead 的方向兜底是死代码（len 被 || 1 兜住，永远不 < 0.001）', () => {
  const h = H.createHarness();
  // 只有蛇长为 1 时 head 与 neck 重合才会触发该分支，而 START_LEN=3 使其不可达。
  // 这里直接验证：即便真的重合，渲染也不会抛异常（只是眼睛画在正中间）
  h.Game.snake = [{ x: 5, y: 5 }];
  h.Game.prevSnake = [{ x: 5, y: 5 }];
  assert.doesNotThrow(() => h.Renderer.render(0.5), '蛇长为 1 时渲染不应抛异常');
  // 正常长度下渲染正常
  h.Game.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
  assert.doesNotThrow(() => h.Renderer.render(0.5));
});

test('08.18 【B轮·暂停特效冻结】暂停时粒子/飘字/震屏随暂停冻结（表现层定格）', () => {
  const h = H.createHarness();
  h.startPlaying();
  const head = h.Game.snake[0];
  h.Game.food = { x: head.x + h.Game.dir.x, y: head.y + h.Game.dir.y };
  pumpUntilTick(h, 1);
  assert.ok(h.Fx.particles.length > 0, '吃到食物应产生粒子');
  assert.ok(h.Fx.time > 0, 'Fx.time 应有累计（食物呼吸动画）');

  h.App.pause();
  const lenBefore = h.Fx.particles.length;
  const lifeBefore = h.Fx.particles[0].life;
  const timeBefore = h.Fx.time;
  const snakeBefore = H.snakeOf(h.Game.snake);
  h.pumpFrames(5);
  assert.strictEqual(h.Fx.particles.length, lenBefore, '暂停时粒子数不变（不被更新/清除，表现层冻结）');
  assert.strictEqual(h.Fx.particles[0].life, lifeBefore, '暂停时粒子 life 不变（冻结）');
  assert.strictEqual(h.Fx.time, timeBefore, '暂停时 Fx.time 不累加（食物呼吸等动画冻结）');
  assert.deepStrictEqual(H.snakeOf(h.Game.snake), snakeBefore, '蛇身冻结');
});

test('08.19 极端舞台尺寸（比最小画布还小）不会崩', () => {
  const h = H.createHarness({ stageSize: 50 });
  h.startPlaying();
  assert.doesNotThrow(() => h.pumpFrames(30));
  assert.ok(h.Renderer.size >= 200, '画布应保持最小尺寸');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, '极小窗口下游戏仍应可玩');
});

test('08.20 全部测试期间没有任何未捕获异常冒泡到 console', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (let i = 0; i < 3000; i++) {
    if (h.Game.state === h.STATE.GAMEOVER) h.key('r');
    if (i % 3 === 0) h.key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][(Math.random() * 4) | 0]);
    if (i % 500 === 0) h.clickSound();
    if (i % 700 === 0) h.winEvent('resize');
    h.pump();
  }
  h.flushTimers();
  assert.deepStrictEqual(h.consoleLog, [],
    '运行期出现 console 输出：' + JSON.stringify(h.consoleLog));
});
