/**
 * 运行：cd tests && node --test
 *
 * 04 - 暂停 / 恢复 与 时间累加器（这类游戏最常见的真实 bug 区域）
 * 覆盖：
 *   - dt 是否被 clamp（切后台回来的巨大 deltaTime 不能被一次性消耗）
 *   - visibilitychange / blur 是否真的自动暂停
 *   - 暂停期间无论如何推进时间，蛇都不动
 *   - resume() 是否清空累加器（恢复瞬间不连跳）
 *   - 单帧补算步数是否受 MAX_STEPS_PER_FRAME 限制（不瞬移）
 *   - alpha 插值系数恒在 [0,1]
 *   - 【已知缺陷 P2】累加器没有上限 clamp，持续低帧率下会无限累积
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/** 让蛇永不死亡，便于测量纯时间行为 */
function keepAlive(h) {
  h.Game.snake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }];
  h.Game.prevSnake = h.Game.snake.map((c) => ({ x: c.x, y: c.y }));
  h.Game.dir = h.DIR.right;
  h.Game.dirQueue = [];
  h.Game.food = { x: 20, y: 20 };
}

/* ================================================================== *
 * 1. dt clamp
 * ================================================================== */
test('04.1 切后台 60 秒后回来：单帧最多推进 MAX_STEPS_PER_FRAME 步，不会瞬移', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pump(100);

  const before = H.cellOf(h.Game.snake[0]);
  const accBefore = h.App.accumulator;
  h.resetTickCount();

  h.pump(100 + 60000);                     // 60 秒空档

  const steps = h.tickCount();
  const after = H.cellOf(h.Game.snake[0]);
  const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);

  assert.ok(steps <= h.Config.MAX_STEPS_PER_FRAME,
    `单帧推进了 ${steps} 步，超过上限 ${h.Config.MAX_STEPS_PER_FRAME}（瞬移）`);
  assert.ok(moved <= h.Config.MAX_STEPS_PER_FRAME,
    `蛇头位移了 ${moved} 格，超过单帧上限`);
  assert.ok(h.App.accumulator - accBefore <= 250 + 1e-6,
    `累加器一帧内增加了 ${(h.App.accumulator - accBefore).toFixed(1)}ms，dt 没有被 clamp 到 0.25s`);
});

test('04.2 dt 上限恒为 0.25s：无论空档多久，单帧累加量都不超过 250ms', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (const gap of [1000, 10000, 60000, 600000, 3600000]) {
    keepAlive(h);
    const accBefore = h.App.accumulator;
    h.pump(h.clock() + gap);
    const delta = h.App.accumulator - accBefore;
    // delta = min(gap, 250) - steps*interval
    assert.ok(delta <= 250 + 1e-6,
      `空档 ${gap}ms 时累加器一帧增加了 ${delta.toFixed(1)}ms，超过 250ms`);
    assert.strictEqual(h.Game.state, h.STATE.PLAYING);
  }
});

test('04.3 alpha 插值系数恒在 [0,1]', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (const gap of [0, 1, 16.7, 100, 250, 1000, 60000]) {
    keepAlive(h);
    h.pump(h.clock() + gap);
    assert.ok(h.App.alpha >= 0 && h.App.alpha <= 1,
      `alpha = ${h.App.alpha} 越界（gap=${gap}）`);
    assert.ok(Number.isFinite(h.App.alpha), `alpha 不是有限数：${h.App.alpha}`);
  }
});

/* ================================================================== *
 * 2. 自动暂停
 * ================================================================== */
test('04.4 visibilitychange 切后台：自动暂停，且暂停期间蛇一步都不动', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pumpFrames(20);

  h.document.hidden = true;
  h.docEvent('visibilitychange');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED, '切后台应自动暂停');

  const snapshot = H.snakeOf(h.Game.snake);
  const ticksBefore = h.tickCount();
  const accAtPause = h.App.accumulator;

  // 后台待 10 分钟后回来
  h.pump(h.clock() + 600000);
  h.pump(h.clock() + 16);
  h.pump(h.clock() + 16);

  assert.strictEqual(h.tickCount(), ticksBefore, '暂停期间不应推进任何 tick');
  assert.deepStrictEqual(H.snakeOf(h.Game.snake), snapshot, '暂停期间蛇身不应变化');
  assert.strictEqual(h.App.accumulator, accAtPause, '暂停期间累加器不应继续累积');
  assert.ok(h.App.accumulator < h.Game.tickInterval(), '暂停时残留累加量应小于一个 tick 间隔');
});

test('04.5 切回前台不会自动恢复（避免用户还没看清就被继续）', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.document.hidden = true;
  h.docEvent('visibilitychange');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);

  h.document.hidden = false;
  h.docEvent('visibilitychange');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED, '回到前台不应自动恢复');
  assert.strictEqual(h.els.get('overlay').hidden, false, '暂停遮罩应可见');
});

test('04.6 resume() 清空累加器：恢复后的第一帧最多推进 1 步', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pumpFrames(20);

  h.document.hidden = true;
  h.docEvent('visibilitychange');
  h.pump(h.clock() + 600000);

  h.document.hidden = false;
  h.App.resume();

  assert.strictEqual(h.App.accumulator, 0, 'resume() 必须清空累加器');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  h.resetTickCount();
  h.pump(h.clock() + 16.7);                 // 恢复后的第一帧
  assert.ok(h.tickCount() <= 1, `恢复后第一帧推进了 ${h.tickCount()} 步，出现连跳`);
});

test('04.7 window blur 同样自动暂停', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.winEvent('blur');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED, '失焦应自动暂停');

  const ticksBefore = h.tickCount();
  h.pump(h.clock() + 300000);
  assert.strictEqual(h.tickCount(), ticksBefore, '失焦暂停期间不应推进');
});

test('04.8 非 playing 状态下 blur / visibilitychange 不会误改状态', () => {
  const h = H.createHarness();
  // ready 状态
  assert.strictEqual(h.Game.state, h.STATE.READY);
  h.winEvent('blur');
  assert.strictEqual(h.Game.state, h.STATE.READY, 'ready 态不应被 blur 改成 paused');
  h.document.hidden = true;
  h.docEvent('visibilitychange');
  assert.strictEqual(h.Game.state, h.STATE.READY, 'ready 态不应被 visibilitychange 改成 paused');
});

/* ================================================================== *
 * 3. 单帧补算上限
 * ================================================================== */
test('04.9 持续低帧率下，单帧补算步数从不超过 MAX_STEPS_PER_FRAME', () => {
  const h = H.createHarness();
  h.startPlaying();

  for (const level of [0, 3, 7, 10, 20]) {
    h.Game.level = level;
    let maxSteps = 0;
    for (let i = 0; i < 200; i++) {
      keepAlive(h);
      h.resetTickCount();
      h.pump(h.clock() + 250);
      maxSteps = Math.max(maxSteps, h.tickCount());
    }
    assert.ok(maxSteps <= h.Config.MAX_STEPS_PER_FRAME,
      `level ${level}：单帧推进了 ${maxSteps} 步，超过上限 ${h.Config.MAX_STEPS_PER_FRAME}`);
  }
});

test('04.10 低帧率下蛇头单帧位移不超过 4 格（不瞬移）', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.Game.level = 20;

  for (let i = 0; i < 200; i++) {
    keepAlive(h);
    const before = H.cellOf(h.Game.snake[0]);
    h.pump(h.clock() + 250);
    const after = H.cellOf(h.Game.snake[0]);
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    assert.ok(moved <= h.Config.MAX_STEPS_PER_FRAME,
      `第 ${i} 帧位移了 ${moved} 格，出现瞬移`);
  }
});

/* ================================================================== *
 * 4. 已知缺陷：累加器没有上限
 * ================================================================== */
test('04.11 【缺陷验证 P2】累加器应有上限，否则持续低帧率会无限累积欠账', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.Game.level = 20;                        // interval = 62.5ms（已触顶 16 tps），4 步消耗 250ms
  const interval = h.Game.tickInterval();
  assert.strictEqual(interval, 62.5);

  const FRAMES = 300;
  for (let i = 0; i < FRAMES; i++) {
    keepAlive(h);
    h.pump(h.clock() + 250);                // 每帧 250ms（相当于 4 fps）
  }

  const acc = h.App.accumulator;
  const cap = h.Config.MAX_STEPS_PER_FRAME * interval;   // 合理的上限：250ms

  // 期望：累加器被 clamp 在 MAX_STEPS_PER_FRAME * interval 以内
  // 当前曲线：interval = 62.5ms，4 步消耗 250ms == dt 上限，每帧净增为 0，累加器始终有界
  assert.ok(acc <= cap,
    `累加器累积到 ${acc.toFixed(0)}ms（上限 ${cap}ms）。\n` +
    `原因：frame() 中 dt 被 clamp 到 0.25s，累加器按 intervalNow * MAX_STEPS_PER_FRAME 封顶。\n` +
    `当前曲线下 interval 最小为 62.5ms（tps 上限 16），4 步可消耗 250ms == dt 上限，\n` +
    `累加器被 clamp 在 cap 内，不会无限增长。`);
});

test('04.12 【缺陷边界 P2】累加器始终有界（不会触发无界增长分支）', () => {
  const h = H.createHarness();
  const g = h.Game;
  // 当前曲线: tps = min(16, 5 + level*1.15)
  // interval 最小 = 1000/16 = 62.5ms，4 步消耗 250ms == dt 上限，累加器恒有界
  assert.ok(g.tps() <= 16, 'level 0 时 tps 应 <= 16');

  for (let lv = 0; lv <= 20; lv++) {
    h.Game.level = lv;
    const tps = h.Game.tps();
    const interval = h.Game.tickInterval();
    assert.ok(tps <= 16, `level ${lv}: tps ${tps} 应 <= 16`);
    // 4 步应至少消化完 dt 的 250ms 上限（用 >= 兼容 4*62.5 恰好 == 250 的边界）
    assert.ok(4 * interval >= 250,
      `level ${lv}: 4 步应至少消化 250ms（interval ${interval.toFixed(1)}ms），累加器有界`);
  }
});

/* ================================================================== *
 * 5. 暂停 / 恢复的状态机完整性
 * ================================================================== */
test('04.13 pause / resume 只在合法状态下生效，重复调用不会出问题', () => {
  const h = H.createHarness();
  h.startPlaying();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  h.App.pause();
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);
  h.App.pause();                            // 重复暂停
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);

  h.App.resume();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
  h.App.resume();                           // 重复恢复
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  h.Game.state = h.STATE.READY;
  h.App.resume();
  assert.strictEqual(h.Game.state, h.STATE.READY, 'ready 态 resume 不应生效');
});

test('04.14 【缺陷验证 P1】空格键应能暂停游戏（README 与页脚均如此宣称）', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pumpFrames(20);
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  h.key(' ', 'Space');                      // 按空格

  // README.md:20  「| 开始 / 暂停 / 继续 / 重开 | `空格` |」
  // index.html:404「<span class="item"><kbd>空格</kbd> / <kbd>Esc</kbd> 暂停</span>」
  // 但 primaryAction()（index.html:1412-1417）只处理 READY / PAUSED / GAMEOVER，
  // 没有 PLAYING 分支，所以游戏中按空格什么都不会发生。
  assert.strictEqual(h.Game.state, h.STATE.PAUSED,
    '游戏中按空格没有暂停：primaryAction() 缺少 PLAYING 分支');

  const snapshot = H.snakeOf(h.Game.snake);
  h.pump(h.clock() + 300000);
  assert.deepStrictEqual(H.snakeOf(h.Game.snake), snapshot);

  h.key(' ', 'Space');                      // 恢复
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
  assert.strictEqual(h.App.accumulator, 0);

  h.resetTickCount();
  h.pump(h.clock() + 16.7);
  assert.ok(h.tickCount() <= 1, `恢复后第一帧推进了 ${h.tickCount()} 步`);
});

test('04.14b 用 Esc 键完成「暂停 → 等待 5 分钟 → 恢复」的完整链路（可用路径）', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pumpFrames(20);

  h.key('Escape');                          // 暂停
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);

  const snapshot = H.snakeOf(h.Game.snake);
  h.pump(h.clock() + 300000);               // 等待 5 分钟
  assert.deepStrictEqual(H.snakeOf(h.Game.snake), snapshot);

  h.key('Escape');                          // 恢复
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
  assert.strictEqual(h.App.accumulator, 0);

  h.resetTickCount();
  h.pump(h.clock() + 16.7);
  assert.ok(h.tickCount() <= 1, `恢复后第一帧推进了 ${h.tickCount()} 步`);
});

test('04.15 Esc 键同样能暂停 / 恢复', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.key('Escape');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);
  h.key('Escape');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
});
