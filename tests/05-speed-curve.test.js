/**
 * 运行：cd tests && node --test
 *
 * 05 - 速度曲线与升级阈值
 * 覆盖：
 *   - tps = min(4 + level*0.9, 13) 单调递增、有上限、有下限
 *   - tickInterval 单调递减
 *   - 速度等级 level 由「过关」驱动（advanceStage 中 level++），不再随 score 变化
 *   - 连续吃食物只加分、蛇身不变长；过关才升一级并增长蛇长
 *   - HUD 显示的等级 / 速度 / 进度条与内部状态一致
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/** 把食物放到蛇头正前方，然后推进一步（必定吃到） */
function feedOnce(h) {
  const g = h.Game;
  const head = g.snake[0];
  const d = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
  const nx = head.x + d.x;
  const ny = head.y + d.y;
  assert.ok(nx >= 0 && ny >= 0 && nx < h.Config.COLS && ny < h.Config.ROWS,
    '喂食用目标越界，测试布局需要调整');
  g.food = { x: nx, y: ny };
  return g.tick();
}

function fresh(h) {
  h.Game.reset();
  h.Game.state = h.STATE.PLAYING;
  return h.Game;
}

/* ================================================================== *
 * 1. 公式本身
 * ================================================================== */
test('05.1 Config 常量与设计一致', () => {
  const h = H.createHarness();
  const c = h.Config;
  assert.strictEqual(c.COLS, 24);
  assert.strictEqual(c.ROWS, 24, 'ROWS 应等于 COLS，画布才是正方形');
  assert.strictEqual(c.BASE_TPS, 4);
  assert.strictEqual(c.MAX_TPS, 13);
  assert.strictEqual(c.TPS_PER_LEVEL, 0.9);
  assert.strictEqual(c.SCORE_PER_FOOD, 10);
  assert.strictEqual(c.SCORE_PER_LEVEL, 100);  // 历史常量，保留（速度等级现由过关驱动，见 advanceStage）
});

test('05.2 tps 随 level 单调不减，且恒在 [4, 13] 区间内', () => {
  const h = H.createHarness();
  const g = h.Game;
  let prev = -Infinity;
  for (let level = 0; level <= 200; level++) {
    g.level = level;
    const t = g.tps();
    assert.ok(t >= prev, `level ${level} 时 tps ${t} 低于上一级 ${prev}，非单调`);
    assert.ok(t >= h.Config.BASE_TPS - 1e-9, `level ${level}：tps ${t} 低于下限`);
    assert.ok(t <= h.Config.MAX_TPS + 1e-9, `level ${level}：tps ${t} 超过上限 13`);
    prev = t;
  }
});

test('05.3 tps 严格等于 min(4 + level*0.9, 13)', () => {
  const h = H.createHarness();
  const g = h.Game;
  for (let level = 0; level <= 60; level++) {
    g.level = level;
    const expected = Math.min(13, 4 + level * 0.9);
    assert.ok(Math.abs(g.tps() - expected) < 1e-9,
      `level ${level}：tps=${g.tps()}，期望 ${expected}`);
  }
});

test('05.4 速度上限在 level 10 触顶，之后不再增长', () => {
  const h = H.createHarness();
  const g = h.Game;

  // level 9 时 tps = 4 + 9*0.9 = 12.1 < 13
  g.level = 9;
  const t9 = g.tps();
  assert.ok(t9 < 13, `level 9 尚未触顶（${t9}）`);
  assert.ok(Math.abs(t9 - 12.1) < 1e-9, `level 9 应为 12.1，实际 ${t9}`);

  // level 10 时 tps = 4 + 10*0.9 = 13，恰好触顶 13
  g.level = 10;
  assert.ok(Math.abs(g.tps() - 13) < 1e-9, `level 10 应恰好触顶 13，实际 ${g.tps()}`);

  for (const lv of [11, 20, 50, 100, 999]) {
    g.level = lv;
    assert.ok(Math.abs(g.tps() - 13) < 1e-9, `level ${lv} 时 tps 应保持 13，实际 ${g.tps()}`);
  }
});

test('05.5 tickInterval = 1000/tps，随等级单调递减', () => {
  const h = H.createHarness();
  const g = h.Game;
  let prev = Infinity;
  for (let level = 0; level <= 60; level++) {
    g.level = level;
    const iv = g.tickInterval();
    assert.ok(Math.abs(iv - 1000 / g.tps()) < 1e-9, `level ${level}：interval 与 tps 不一致`);
    assert.ok(iv <= prev + 1e-9, `level ${level}：interval ${iv} 反而变大了`);
    assert.ok(iv > 0 && Number.isFinite(iv), `level ${level}：interval 非法 ${iv}`);
    prev = iv;
  }
  // 最快 13 格/秒 -> 1000/13 ≈ 76.9ms 一步
  g.level = 999;
  assert.ok(Math.abs(g.tickInterval() - 1000 / 13) < 1e-9);
});

/* ================================================================== *
 * 2. 升级阈值与得分逻辑
 * ================================================================== */
test('05.6 吃食物只加分不升级（level 不再随 score 变化，升级改由过关驱动）', () => {
  const h = H.createHarness();
  const g = h.Game;

  const scores = [0, 10, 20, 30, 40, 90, 140, 240, 290, 490, 990, 4990];
  for (const s of scores) {
    const gg = fresh(h);
    gg.score = s;
    gg.level = 0;
    assert.strictEqual(feedOnce(h), 'eat', `score=${s} 时应吃到食物`);
    const newScore = s + h.Config.SCORE_PER_FOOD;
    assert.strictEqual(gg.score, newScore, '吃食物只加分');
    assert.strictEqual(gg.level, 0, `score=${newScore} 不应改变 level（升级改由过关触发），实际 ${gg.level}`);
    assert.strictEqual(gg.snake.length, h.Config.START_LEN, '吃食物蛇身不变长');
  }
});

test('05.7 连续吃 10 颗：按连击倍率加分、蛇身不变长、level 不变（升级改由过关）', () => {
  const h = H.createHarness();
  const g = fresh(h);
  assert.strictEqual(g.level, 0);
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.combo, 0, '开局连击应为 0');
  assert.strictEqual(g.snake.length, h.Config.START_LEN);

  // E 轮：第 N 颗得分 = SCORE_PER_FOOD × 连击倍率（第 N 连 = 1 + (N-1)×0.1，封顶 3）
  let expect = 0;
  for (let i = 1; i <= 10; i++) {
    assert.strictEqual(feedOnce(h), 'eat', `第 ${i} 颗应吃到`);
    expect += Math.round(h.Config.SCORE_PER_FOOD * g.comboMultiplier());
    assert.strictEqual(g.score, expect, `第 ${i} 颗后累计得分应为 ${expect}，实际 ${g.score}`);
    assert.strictEqual(g.combo, i, `第 ${i} 颗后连击层数应为 ${i}，实际 ${g.combo}`);
    assert.strictEqual(g.level, 0, `第 ${i} 颗后 level 仍应为 0（升级由过关触发），实际 ${g.level}`);
    assert.strictEqual(g.snake.length, h.Config.START_LEN,
      `第 ${i} 颗后蛇长应恒为 ${h.Config.START_LEN}，实际 ${g.snake.length}`);
  }
  assert.ok(g.comboBest >= 10, `最高连击应记录到 10 以上，实际 ${g.comboBest}`);
});

test('05.8 不吃食物时 level / tps 不变（升级只由过关驱动）', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.food = { x: 20, y: 20 };
  const lvl0 = g.level;
  const tps0 = g.tps();
  for (let i = 0; i < 5; i++) {
    const r = g.tick();
    assert.notStrictEqual(r, 'eat', '这几步不应该吃到食物');
  }
  assert.strictEqual(g.level, lvl0);
  assert.strictEqual(g.tps(), tps0);
});

test('05.9 过关会升一级且提速（level++ 后 tps 提升，与闯关机制一致）', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.state = h.STATE.PLAYING;
  assert.strictEqual(g.level, 0);
  assert.ok(Math.abs(g.tps() - 4) < 1e-9, '初始 level 0 速度 4');
  // 直接模拟过关升级（advanceStage 内含 level++）
  g.advanceStage();
  assert.strictEqual(g.level, 1, '过关应升到 level 1');
  assert.ok(g.tps() > 4, '升级后速度应提升');
  // 一路升到触顶
  for (let i = 0; i < 20; i++) g.advanceStage();
  assert.ok(Math.abs(g.tps() - 13) < 1e-9, '足够多关后速度应触顶 13 格/秒');
});

/* ================================================================== *
 * 3. HUD 一致性
 * ================================================================== */
test('05.10 HUD 显示的等级、速度、进度条与内部状态一致', () => {
  const h = H.createHarness();
  const g = h.Game;

  for (const level of [0, 1, 5, 9, 10, 20]) {
    g.level = level;
    h.UI.updateHud();
    assert.strictEqual(h.els.get('levelEl').textContent, String(level + 1),
      `HUD 等级应显示为 level+1`);
    assert.strictEqual(h.els.get('tpsEl').textContent, g.tps().toFixed(1) + '/s',
      'HUD 速度文本与 tps() 不一致');

    const width = h.els.get('speedFill').style.width;
    const pct = parseFloat(width);
    assert.ok(pct >= 0 && pct <= 100, `进度条宽度 ${width} 越界`);
    if (level >= 10) assert.strictEqual(pct, 100, '满速时进度条应为 100%');
  }
});

test('05.11 得分与最高分的 HUD 同步', () => {
  const h = H.createHarness();
  h.Game.score = 70;
  h.Game.best = 250;
  h.UI.updateHud();
  assert.strictEqual(h.els.get('scoreEl').textContent, '70');
  assert.strictEqual(h.els.get('bestEl').textContent, '250');
});

test('05.12 速度曲线端到端：等级越高，同样时长内推进的 tick 越多', () => {
  const h = H.createHarness();
  function ticksInOneSecond(level) {
    const hh = H.createHarness();
    hh.startPlaying();
    hh.Game.level = level;
    hh.App.accumulator = 0;
    hh.resetTickCount();
    // 用 60 帧 × 16.7ms 模拟 1 秒
    for (let i = 0; i < 60; i++) {
      // 保命，避免撞墙提前结束
      hh.Game.snake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }];
      hh.Game.prevSnake = hh.Game.snake.map((c) => ({ x: c.x, y: c.y }));
      hh.Game.dir = hh.DIR.right;
      hh.Game.dirQueue = [];
      hh.Game.food = { x: 20, y: 20 };
      hh.pump(hh.clock() + 1000 / 60);
    }
    return hh.tickCount();
  }
  const t0 = ticksInOneSecond(0);
  const t5 = ticksInOneSecond(5);
  const t9 = ticksInOneSecond(9);
  const t20 = ticksInOneSecond(20);

  // level 0 (4 tps) 一秒应约 3~6 步（受帧率抖动 ±1）
  assert.ok(t0 >= 3 && t0 <= 6, `level 0 一秒应约 3~6 步，实际 ${t0}`);
  assert.ok(t5 > t0, `level 5 应比 level 0 快（${t5} vs ${t0}）`);
  assert.ok(t9 > t5, `level 9 应比 level 5 快（${t9} vs ${t5}）`);
  assert.ok(t20 >= t9, `level 20 应不慢于 level 9（${t20} vs ${t9}）`);
  // level 20 已触顶 13 tps，1 秒最多 13 步；考虑累加器封顶 4 步/帧 * 60 帧 = 240 步上限，
  // 实际受 dt=0.25s 钳制，每秒 13 步 ≈ 1秒精确区间，留余量
  assert.ok(t20 <= 16, `level 20 一秒最多 16 步（13 tps + 抖动），实际 ${t20}`);
});
