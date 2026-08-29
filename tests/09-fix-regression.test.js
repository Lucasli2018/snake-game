/**
 * 运行：cd tests && node --test
 *
 * 09 - 修复回归（第 2 轮新增）
 *
 * 针对第 1 轮报出的两个缺陷，把"修好的行为"永久钉死，防止以后改回去：
 *   P1  空格键暂停（index.html primaryAction 的 PLAYING 分支）
 *   P2  时间累加器封顶（index.html frame() 的 accCap）
 *   P3a drawHead 方向兜底（蛇长为 1 时退化到 Game.dir）
 *
 * 另含一条**测试脚手架自身的正确性**用例（09.4）：
 *   第 1 轮修 P1 时暴露了 harness 曾错误复用 innerHTML 生成的 ovBtn 节点，
 *   导致监听器叠加。这条用例保证该缺陷不会以任何形式回归。
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
 * P1：空格暂停
 * ================================================================== */
test('09.1 【P1】游戏中按空格能暂停，再按一次能继续', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pumpFrames(20);
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  h.key(' ', 'Space');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED, '游戏中按空格应暂停');
  assert.strictEqual(h.els.get('overlay').hidden, false, '暂停遮罩应显示');

  h.key(' ', 'Space');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, '暂停中按空格应继续');
  assert.strictEqual(h.App.accumulator, 0, '恢复时应清空累加器');
});

test('09.2 【P1】空格与 Esc 行为一致，且都不破坏其他状态', () => {
  const h = H.createHarness();
  h.startPlaying();

  // 空格 暂停 -> Esc 继续
  h.key(' ', 'Space');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);
  h.key('Escape');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  // Esc 暂停 -> 空格 继续
  h.key('Escape');
  assert.strictEqual(h.Game.state, h.STATE.PAUSED);
  h.key(' ', 'Space');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);

  // 其他状态不受影响
  h.Game.state = h.STATE.GAMEOVER;
  h.UI.syncOverlay();
  h.key(' ', 'Space');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'gameover 按空格应重开，而不是暂停');

  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  h.key(' ', 'Space');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'ready 按空格应开始，而不是暂停');
});

test('09.3 【P1】暂停期间蛇身与时间都不推进，恢复后最多补 1 步', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.pumpFrames(20);

  h.key(' ', 'Space');
  const snapshot = H.snakeOf(h.Game.snake);
  const ticksBefore = h.tickCount();
  h.pump(h.clock() + 300000);                  // 暂停中挂机 5 分钟
  assert.strictEqual(h.tickCount(), ticksBefore, '暂停期间不应推进');
  assert.deepStrictEqual(H.snakeOf(h.Game.snake), snapshot);

  h.key(' ', 'Space');
  h.resetTickCount();
  h.pump(h.clock() + 16.7);
  assert.ok(h.tickCount() <= 1, `恢复后第一帧推进了 ${h.tickCount()} 步`);
});

test('09.4 【脚手架正确性】innerHTML 重建后 ovBtn 监听器恒为 1，点一次只触发一次动作', () => {
  const h = H.createHarness();

  // 浏览器里 panel.innerHTML = html 会重建整棵子树，ovBtn 是全新节点。
  // harness 必须复现这一点，否则监听器会叠加，一次点击触发 N 次 primaryAction。
  for (let i = 1; i <= 5; i++) {
    h.Game.state = h.STATE.READY;
    h.UI.syncOverlay();
    const btn = h.els.get('ovBtn');
    assert.strictEqual((btn._listeners.click || []).length, 1,
      `第 ${i} 次 syncOverlay 后 ovBtn 上有 ${(btn._listeners.click || []).length} 个 click 监听器，应为 1`);
  }

  // 关键回归点：若监听器叠加，gameover 点击会 restart 后又被 pause，
  // 最终状态会是 paused 而不是 playing。
  h.Game.state = h.STATE.GAMEOVER;
  h.UI.syncOverlay();
  h.clickPanelBtn();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING,
    'gameover 点击"再来一局"后应直接开局（若变成 paused 说明监听器叠加了）');

  h.Game.state = h.STATE.PAUSED;
  h.UI.syncOverlay();
  h.clickPanelBtn();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'paused 点击"继续游戏"后应继续');
});

test('09.5【P1 安全性】遮罩/按钮的点击路径不会因新增 PLAYING 分支而误暂停', () => {
  const h = H.createHarness();
  h.startPlaying();

  // PLAYING 时遮罩是隐藏的；即便强行触发 click，也不应改变状态之外的东西
  assert.strictEqual(h.els.get('overlay').hidden, true, 'PLAYING 时遮罩必须隐藏');

  // 触摸路径不受影响
  h.tap();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'PLAYING 中轻点不应误暂停');
  h.swipe(0, -80);
  assert.strictEqual(h.Game.dirQueue.length, 1, '滑动应正常入队');
});

/* ================================================================== *
 * P2：累加器封顶
 * ================================================================== */
test('09.6 【P2】持续低帧率下累加器恒不超过 4×interval 的上限', () => {
  for (const level of [0, 3, 6, 7, 10, 20]) {
    const h = H.createHarness();
    h.startPlaying();
    h.Game.level = level;
    const interval = h.Game.tickInterval();
    const cap = interval * h.Config.MAX_STEPS_PER_FRAME;

    for (let i = 0; i < 400; i++) {
      keepAlive(h);
      h.pump(h.clock() + 250);                 // 4fps
      assert.ok(h.App.accumulator <= cap + 1e-6,
        `level ${level} 第 ${i} 帧：累加器 ${h.App.accumulator.toFixed(1)}ms 超过上限 ${cap.toFixed(1)}ms`);
      assert.ok(h.App.accumulator >= -1e-6, '累加器不应为负');
    }
  }
});

test('09.7 【P2】累加器始终有界（被 clamp 在 interval×MAX_STEPS 内），不无限增长', () => {
  function run(level, frames) {
    const h = H.createHarness();
    h.startPlaying();
    h.Game.level = level;
    const samples = [];
    for (let i = 0; i < frames; i++) {
      keepAlive(h);
      h.pump(h.clock() + 250);
      samples.push(h.App.accumulator);
    }
    return samples;
  }

  const BASE = 4.25, PER = 0.575, STEP = 4;
  const capOf = (lv) => (1000 / (BASE + lv * PER)) * STEP;
  const cap7 = capOf(7);    // ≈ 483ms
  const cap20 = capOf(20);  // = 400ms

  const s7 = run(7, 400);
  const s20 = run(20, 400);

  // 慢速下 interval 较大，每帧 250ms 无法被 4 步整除，累加器在 [0, cap] 间波动，
  // 但始终被 clamp 在 cap 内——证明 P2 修复生效（有界、不发散）。
  assert.ok(Math.max(...s7) <= cap7 + 1e-6, `level 7 累加器应 <= cap ${cap7.toFixed(1)}ms`);
  assert.ok(Math.max(...s20) <= cap20 + 1e-6, `level 20 累加器应 <= cap ${cap20.toFixed(1)}ms`);

  const late7 = s7.slice(200);
  const late20 = s20.slice(200);
  assert.ok(Math.max(...late7) - Math.min(...late7) < cap7,
    `level 7 后期应不发散（波动 ${(Math.max(...late7) - Math.min(...late7)).toFixed(1)}ms）`);
  assert.ok(Math.max(...late20) - Math.min(...late20) < cap20,
    `level 20 后期应不发散（波动 ${(Math.max(...late20) - Math.min(...late20)).toFixed(1)}ms）`);
});

test('09.8 【P2】帧率恢复后不会长时间"快进补账"（与修复前的关键差异）', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.Game.level = 20;                            // 慢速下 interval = 100ms
  const interval = h.Game.tickInterval();
  assert.strictEqual(interval, 100);

  // 先在 4fps 下跑 400 帧（修复前这里会累积到 15000ms；慢速下区间更大，cap=400ms）
  for (let i = 0; i < 400; i++) {
    keepAlive(h);
    h.pump(h.clock() + 250);
  }
  const accAfterLag = h.App.accumulator;

  // 然后恢复到 60fps，跑 60 帧（合计 1002ms，正常应为约 10 个 tick）
  h.resetTickCount();
  for (let i = 0; i < 60; i++) {
    keepAlive(h);
    h.pump(h.clock() + 1000 / 60);
  }
  const ticks = h.tickCount();
  const expected = 1002 / interval;             // ≈ 10

  // 允许最多再补 4 个 tick（一帧上限 4 × 100ms = 400ms 的欠账）
  const maxAllowed = Math.ceil(expected) + h.Config.MAX_STEPS_PER_FRAME;
  assert.ok(ticks <= maxAllowed,
    `帧率恢复后 60 帧内推进了 ${ticks} 个 tick，正常应为 ${Math.ceil(expected)} 个 ` +
    `（允许补 ${h.Config.MAX_STEPS_PER_FRAME} 个）。欠账起始值 ${accAfterLag.toFixed(0)}ms`);
  assert.ok(accAfterLag <= 400 + 1e-6, `低帧率期间累积的欠账应 <=400ms（cap），实际 ${accAfterLag.toFixed(1)}ms`);
});

test('09.9 【P2】封顶不影响正常帧率下的速度（60fps 时累加器远低于上限）', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (const level of [0, 5, 20]) {
    h.Game.level = level;
    h.App.accumulator = 0;
    let maxAcc = 0;
    for (let i = 0; i < 200; i++) {
      keepAlive(h);
      h.pump(h.clock() + 1000 / 60);
      maxAcc = Math.max(maxAcc, h.App.accumulator);
    }
    const cap = h.Game.tickInterval() * h.Config.MAX_STEPS_PER_FRAME;
    assert.ok(maxAcc < cap,
      `level ${level} 60fps 下累加器峰值 ${maxAcc.toFixed(1)}ms 竟触及上限 ${cap.toFixed(1)}ms`);
  }
});

test('09.10 【P2】空档仍然受 dt clamp 保护（累加器上限不能替代 dt clamp）', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (const gap of [1000, 60000, 3600000]) {
    keepAlive(h);
    h.resetTickCount();
    h.pump(h.clock() + gap);
    assert.ok(h.tickCount() <= h.Config.MAX_STEPS_PER_FRAME,
      `空档 ${gap}ms 时单帧推进了 ${h.tickCount()} 步`);
  }
});

/* ================================================================== *
 * P3a：drawHead 方向兜底
 * ================================================================== */
/** 用录制型 ctx 抓下 drawHead 画眼睛时的 arc 坐标 */
function recordArcs(dirName, snakeCells) {
  const h = H.createHarness();
  const calls = [];
  const rec = new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'createRadialGradient' || p === 'createLinearGradient') {
        return () => ({ addColorStop() {} });
      }
      return (...args) => { calls.push([p, ...args]); };
    },
    set() { return true; }
  });
  h.Renderer.ctx = rec;
  h.Game.snake = snakeCells.map((c) => ({ x: c[0], y: c[1] }));
  h.Game.prevSnake = h.Game.snake.map((c) => ({ x: c.x, y: c.y }));
  h.Game.dir = h.DIR[dirName];
  // 食物位置是 reset() 随机出来的，必须钉死，
  // 否则两次调用之间"苹果"的 arc 坐标不同，会污染对蛇头的比较。
  h.Game.food = { x: 20, y: 20 };
  h.Renderer.render(1);
  return JSON.stringify(calls.filter((c) => c[0] === 'arc').map((c) => [c[1], c[2]]));
}

test('09.11 【P3a】蛇长为 1 时蛇头朝向退化为 Game.dir（兜底分支真的生效）', () => {
  const up = recordArcs('up', [[5, 5]]);
  const down = recordArcs('down', [[5, 5]]);
  const left = recordArcs('left', [[5, 5]]);
  const right = recordArcs('right', [[5, 5]]);

  // 若兜底没生效，四个方向画出来的眼睛会完全重合（都挤在脑袋正中间）
  assert.notStrictEqual(up, down, 'dir=up 与 dir=down 的蛇头绘制应不同（兜底未生效？）');
  assert.notStrictEqual(left, right, 'dir=left 与 dir=right 的蛇头绘制应不同');
  assert.notStrictEqual(up, left, 'dir=up 与 dir=left 的蛇头绘制应不同');
});

test('09.12 【P3a】蛇长为 1 时四个方向渲染都不抛异常，且不产生 NaN 坐标', () => {
  for (const d of ['up', 'down', 'left', 'right']) {
    const h = H.createHarness();
    const bad = [];
    const rec = new Proxy({}, {
      get(t, p) {
        if (typeof p === 'symbol') return undefined;
        if (p === 'createRadialGradient' || p === 'createLinearGradient') {
          return () => ({ addColorStop() {} });
        }
        return (...args) => {
          for (const a of args) {
            if (typeof a === 'number' && !isFinite(a)) bad.push(p);
          }
        };
      },
      set() { return true; }
    });
    h.Renderer.ctx = rec;
    h.Game.snake = [{ x: 5, y: 5 }];
    h.Game.prevSnake = [{ x: 5, y: 5 }];
    h.Game.dir = h.DIR[d];
    assert.doesNotThrow(() => h.Renderer.render(1), `dir=${d} 渲染抛异常`);
    assert.deepStrictEqual([...new Set(bad)], [], `dir=${d} 绘制出现非有限数坐标：${bad.join(',')}`);
  }
});

test('09.13 【P3a】正常蛇长下朝向仍由 head-neck 决定，不受兜底改动影响', () => {
  // 同一条蛇（head 在 (5,5)，neck 在 (5,6) -> 朝上），改变 Game.dir 不应改变绘制
  const a = recordArcs('up', [[5, 5], [5, 6], [5, 7]]);
  const b = recordArcs('left', [[5, 5], [5, 6], [5, 7]]);
  assert.strictEqual(a, b, '正常蛇长下蛇头朝向应由 head-neck 决定，与 Game.dir 无关');
});

/* ================================================================== *
 * 全套回归：修改后核心行为不变
 * ================================================================== */
test('09.14 修复后核心玩法回归：长时间游玩仍然零反向、零重叠', () => {
  const h = H.createHarness();
  h.startPlaying();
  for (let i = 0; i < 10000; i++) {
    if (h.Game.state === h.STATE.GAMEOVER) h.key('r');
    if (i % 5 === 0) {
      const n = H.autoPickDir(h, true);
      h.key({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[n]);
    }
    // 随机插入暂停/恢复，验证状态机在频繁切换下依然自洽
    if (i % 997 === 0) h.key(' ', 'Space');
    if (i % 997 === 500) h.key(' ', 'Space');
    h.pump();

    assert.ok(!H.hasDuplicateCells(h.Game.snake), `第 ${i} 帧蛇身重叠`);
    assert.ok(H.isContiguous(h.Game.snake), `第 ${i} 帧蛇身脱节`);
    assert.ok(h.App.alpha >= 0 && h.App.alpha <= 1, `第 ${i} 帧 alpha 越界 ${h.App.alpha}`);
  }
  assert.deepStrictEqual(h.consoleLog, [], '运行期出现 console 输出');
});
