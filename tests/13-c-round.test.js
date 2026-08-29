/**
 * 运行：cd tests && node --test
 *
 * 13 - C 轮：特殊食物（P1 体验增强）
 * 覆盖：
 *   - 配置常量齐全
 *   - 金蛇果加速 / 冰冻果减速 / 限时奖励加分 三种效果
 *   - 速度 buff 叠加后 tps 变化，且减速不低于下限、默认 0 不影响原速度曲线
 *   - 特殊食物生成在空格（不与蛇身/普通食物重叠），同一时刻最多一颗
 *   - tick 吃到特殊食物返回 'special'、蛇身不增长、正确触发效果
 *   - updateTimers：buff / 特殊食物 TTL 随时间衰减并到期清除，到点自动生成
 *   - 渲染 drawSpecial 三种类型都不抛异常
 *   - 加速/减速状态条（buff-bar）显隐正确
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/* ================================================================== *
 * 1. 配置常量
 * ================================================================== */
test('13.1 特殊食物配置常量齐全且取值合理', () => {
  const c = H.createHarness().Config;
  assert.strictEqual(c.SPECIAL_GOLD_ADD, 4);
  assert.ok(c.SPECIAL_GOLD_TIME > 0);
  assert.ok(c.SPECIAL_GOLD_TTL > 0);
  assert.strictEqual(c.SPECIAL_ICE_ADD, 3);
  assert.ok(c.SPECIAL_ICE_TIME > 0);
  assert.ok(c.SPECIAL_ICE_TTL > 0);
  assert.strictEqual(c.SPECIAL_BONUS_SCORE, 25);
  assert.ok(c.SPECIAL_BONUS_TIME > 0);
  assert.ok(c.SPECIAL_MIN_TPS >= 1 && c.SPECIAL_MIN_TPS < c.BASE_TPS, '减速下限应低于初始速度');
  assert.ok(c.SPECIAL_SPAWN_INTERVAL > 0, '自动生成间隔应大于 0');
});

test('13.2 无 buff 时 tps 与原曲线完全一致（不破坏速度体验）', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  assert.strictEqual(g.speedBuffAdd, 0, '初始应无 buff');
  assert.strictEqual(g.tps(), 5, 'level 0 速度应仍为 5');
  g.level = 10;
  assert.ok(Math.abs(g.tps() - 16) < 1e-9, '高等级触顶 16 不受影响');
});

/* ================================================================== *
 * 2. 三种效果
 * ================================================================== */
test('13.3 金蛇果：tps 临时 +4，且到点后自动清除', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.applySpecial({ type: 'gold' });
  assert.strictEqual(g.speedBuffAdd, 4);
  assert.strictEqual(g.speedBuffTime, h.Config.SPECIAL_GOLD_TIME);
  assert.ok(Math.abs(g.tps() - 9) < 1e-9, '5 + 4 = 9 格/秒');

  // 时间耗尽后 buff 归零
  g.updateTimers(h.Config.SPECIAL_GOLD_TIME + 0.1);
  assert.strictEqual(g.speedBuffAdd, 0, 'buff 到点应清除');
  assert.strictEqual(g.speedBuffTime, 0);
  assert.strictEqual(g.tps(), 5, '清除后速度复原');
});

test('13.4 冰冻果：tps 临时减速，但不低于下限；到点清除', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;

  g.reset();                          // level 0，base = 5
  g.applySpecial({ type: 'ice' });
  assert.strictEqual(g.speedBuffAdd, -c.SPECIAL_ICE_ADD);
  const slowed = g.tps();
  assert.ok(slowed < 5, '应比初始速度慢');
  assert.ok(slowed >= c.SPECIAL_MIN_TPS, '不得低于减速下限 ' + c.SPECIAL_MIN_TPS + '，实际 ' + slowed);

  // 高等级下减速仍生效但不破下限
  g.level = 20;
  g.applySpecial({ type: 'ice' });
  assert.strictEqual(g.tps(), 16 - c.SPECIAL_ICE_ADD, '高等级减速应为 16 - 3');

  g.updateTimers(c.SPECIAL_ICE_TIME + 0.1);
  assert.strictEqual(g.speedBuffAdd, 0);
});

test('13.5 限时奖励：额外加分并同步速度等级', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.score = 90;
  g.level = 0;
  g.applySpecial({ type: 'bonus' });
  assert.strictEqual(g.score, 115, '90 + 25 = 115');
  assert.strictEqual(g.level, 1, '跨过 100 分阈值应升到 Lv.2');
  assert.strictEqual(g.speedBuffAdd, 0, '限时奖励不应改变速度');
});

/* ================================================================== *
 * 3. 生成与位置合法性
 * ================================================================== */
test('13.6 placeSpecial 生成的特殊食物不与蛇身/普通食物重叠', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;

  for (let trial = 0; trial < 2000; trial++) {
    g.reset();
    assert.strictEqual(g.placeSpecial('gold'), true, '空格充足时应能放置');
    const sp = g.special;
    assert.ok(sp.x >= 0 && sp.x < COLS && sp.y >= 0 && sp.y < ROWS, '特殊食物坐标越界');
    const onSnake = g.snake.some((s) => s.x === sp.x && s.y === sp.y);
    assert.ok(!onSnake, '特殊食物压在蛇身上');
    const onFood = (g.food.x === sp.x && g.food.y === sp.y);
    assert.ok(!onFood, '特殊食物与普通食物重叠');
    assert.strictEqual(sp.ttl, h.Config.SPECIAL_GOLD_TTL);
  }
});

test('13.7 同一时刻最多一颗特殊食物；强制生成返回 null', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  assert.strictEqual(g.spawnSpecial('gold'), 'gold');
  assert.strictEqual(g.spawnSpecial('ice'), null, '已有特殊食物时不应再生成');
  assert.strictEqual(g.special.type, 'gold', '类型应保持不变');
});

test('13.8 randomEmptyCell 排除普通食物所在格（数千次随机）', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.snake = [{ x: 12, y: 12 }];
  g.food = { x: 3, y: 7 };

  let rnd = 999;
  for (let i = 0; i < 5000; i++) {
    rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
    const cell = g.randomEmptyCell();
    assert.ok(cell, '非满盘时应返回空格');
    assert.ok(!(cell.x === 3 && cell.y === 7), '不应返回食物所在格');
    assert.ok(!(cell.x === 12 && cell.y === 12), '不应返回蛇身所在格');
  }
});

test('13.9 满盘时 placeSpecial 返回 false（不崩溃）', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const snake = [];
  for (let i = 0; i < COLS * ROWS; i++) snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
  g.snake = snake;
  g.food = { x: -1, y: -1 };
  assert.strictEqual(g.placeSpecial('bonus'), false, '满盘时不应生成特殊食物');
});

/* ================================================================== *
 * 4. tick 吃到特殊食物
 * ================================================================== */
test('13.10 吃到特殊食物：tick 返回 special，蛇身不增长，效果生效', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;

  g.reset();
  g.state = h.STATE.PLAYING;
  const head = g.snake[0];
  // 把特殊食物放在蛇头右侧（前进方向）
  const sx = Math.min(COLS - 1, head.x + 1);
  g.food = { x: 0, y: 0 };                 // 远离，避免与 special 同格
  g.special = { x: sx, y: head.y, type: 'gold', ttl: 8, maxTtl: 8 };
  g.dir = h.DIR.right;
  g.dirQueue = [];

  const lenBefore = g.snake.length;
  const r = g.tick();
  assert.strictEqual(r, 'special', '应返回 special');
  assert.strictEqual(g.snake.length, lenBefore, '吃特殊食物不应增长蛇身');
  assert.strictEqual(g.special, null, '吃掉的特应按应被清除');
  assert.strictEqual(g.speedBuffAdd, 4, '金蛇果效果应已生效');
  assert.ok(g.speedBuffTime > 0);

  // 蛇身依然自洽
  assert.ok(!H.hasDuplicateCells(g.snake));
  assert.ok(H.isContiguous(g.snake));
});

test('13.11 吃冰冻果 / 限时奖励同样返回 special 且不增长蛇身', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS } = h.Config;

  for (const type of ['ice', 'bonus']) {
    g.reset();
    g.state = h.STATE.PLAYING;
    const head = g.snake[0];
    const sx = Math.min(COLS - 1, head.x + 1);
    g.food = { x: 0, y: 0 };
    g.special = { x: sx, y: head.y, type: type, ttl: 8, maxTtl: 8 };
    g.dir = h.DIR.right;
    g.dirQueue = [];
    const lenBefore = g.snake.length;
    const r = g.tick();
    assert.strictEqual(r, 'special', type + ' 应返回 special');
    assert.strictEqual(g.snake.length, lenBefore, type + ' 不应增长蛇身');
    assert.strictEqual(g.special, null);
    if (type === 'ice') assert.strictEqual(g.speedBuffAdd, -h.Config.SPECIAL_ICE_ADD);
    else assert.strictEqual(g.score, h.Config.SPECIAL_BONUS_SCORE);
  }
});

/* ================================================================== *
 * 5. 计时器：自动生成 + 到期清除
 * ================================================================== */
test('13.12 updateTimers 到点自动生成特殊食物（同一时刻一颗）', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.state = h.STATE.PLAYING;
  g.special = null;
  g.specialSpawnTimer = h.Config.SPECIAL_SPAWN_INTERVAL;   // 刚好到点
  g.updateTimers(0.001);
  assert.ok(g.special, '到点应自动生成一个特殊食物');
  assert.strictEqual(g.specialSpawnTimer, 0, '生成后应重置计时器');

  // 已有特殊食物时即使到点也不再生成
  const before = g.special.type;
  g.specialSpawnTimer = h.Config.SPECIAL_SPAWN_INTERVAL;
  g.updateTimers(0.001);
  assert.strictEqual(g.special.type, before, '已有特殊食物时不应覆盖');
});

test('13.13 特殊食物 TTL 到点后消失（不吃则消失）', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.special = { x: 1, y: 1, type: 'bonus', ttl: 2, maxTtl: 2 };
  g.updateTimers(2.1);
  assert.strictEqual(g.special, null, 'TTL 耗尽应消失');
});

test('13.14 暂停时 buff 冻结（走真实主循环：暂停态不推进 updateTimers）', () => {
  const h = H.createHarness();
  const g = h.Game;
  h.startPlaying();
  g.applySpecial({ type: 'gold' });         // speedBuffTime = 5
  const before = g.speedBuffTime;
  assert.ok(before > 0, '应先有 buff');

  // 玩一会：buff 应随时间衰减
  h.pumpFrames(30);
  const playingTime = g.speedBuffTime;
  assert.ok(playingTime < before, 'PLAYING 时 buff 应衰减');

  // 暂停后再 pump：buff / tps 必须冻结（主循环暂停分支不调用 updateTimers）
  h.App.pause();
  assert.strictEqual(g.state, h.STATE.PAUSED);
  const tpsBeforePause = g.tps();
  h.pumpFrames(30);
  assert.strictEqual(g.speedBuffTime, playingTime, '暂停时 buff 应冻结不动');
  assert.strictEqual(g.tps(), tpsBeforePause, '暂停时 tps 应冻结');
});

/* ================================================================== *
 * 6. 渲染 / 特效
 * ================================================================== */
test('13.15 三种特殊食物的 drawSpecial 都不抛异常', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.special = { x: 5, y: 5, type: 'gold', ttl: 6, maxTtl: 8 };
  assert.doesNotThrow(() => h.Renderer.render(0.5), 'gold 渲染抛异常');
  g.special = { x: 5, y: 5, type: 'ice', ttl: 3, maxTtl: 8 };
  assert.doesNotThrow(() => h.Renderer.render(0.5), 'ice 渲染抛异常');
  g.special = { x: 5, y: 5, type: 'bonus', ttl: 1, maxTtl: 6 };
  assert.doesNotThrow(() => h.Renderer.render(0.5), 'bonus 渲染抛异常');
  g.special = null;
  assert.doesNotThrow(() => h.Renderer.render(0.5), '无特殊食物渲染抛异常');
});

test('13.16 主循环真实吃到金蛇果：buff 生效 + 状态条显示 + 加速可见', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  const { COLS } = c;
  h.startPlaying();

  const head = g.snake[0];
  const sx = Math.min(COLS - 1, head.x + 1);
  g.food = { x: 0, y: 0 };
  g.special = { x: sx, y: head.y, type: 'gold', ttl: 8, maxTtl: 8 };
  g.dir = h.DIR.right;
  g.dirQueue = [];

  const tpsBefore = g.tps();
  // 推进若干帧直到吃到特殊食物（level 0 间隔 200ms，约 12 帧一步）
  let guard = 0;
  while (g.special && g.state === h.STATE.PLAYING && guard++ < 120) h.pump();

  assert.strictEqual(g.special, null, '应已吃到特殊食物');
  assert.strictEqual(g.speedBuffAdd, 4, '金蛇果 buff 应生效');
  assert.ok(g.tps() > tpsBefore, '加速应可见');
  // 状态条应显示
  assert.strictEqual(h.els.get('buffBar').hidden, false, '加速状态条应可见');
  assert.strictEqual(h.els.get('buffTx').textContent, '加速');
});

/* ================================================================== *
 * 7. 加速/减速状态条显隐
 * ================================================================== */
test('13.17 updateBuff 按状态正确显隐', () => {
  const h = H.createHarness();
  const g = h.Game;
  const bar = h.els.get('buffBar');

  // 无 buff -> 隐藏
  g.reset();
  g.state = h.STATE.PLAYING;
  g.speedBuffAdd = 0; g.speedBuffTime = 0;
  h.UI.updateBuff();
  assert.strictEqual(bar.hidden, true, '无 buff 应隐藏');

  // 金蛇果 buff -> 显示「加速」
  g.speedBuffAdd = 4; g.speedBuffTime = 3.4;
  h.UI.updateBuff();
  assert.strictEqual(bar.hidden, false);
  assert.strictEqual(h.els.get('buffTx').textContent, '加速');
  assert.strictEqual(bar.classList.contains('gold'), true);

  // 冰冻果 buff -> 显示「减速」
  g.speedBuffAdd = -3; g.speedBuffTime = 2.1;
  h.UI.updateBuff();
  assert.strictEqual(h.els.get('buffTx').textContent, '减速');
  assert.strictEqual(bar.classList.contains('ice'), true);

  // 游戏结束 -> 隐藏
  g.state = h.STATE.GAMEOVER;
  h.UI.updateBuff();
  assert.strictEqual(bar.hidden, true, '结束态应隐藏状态条');
});

/* ================================================================== *
 * 8. 长时间随机对局：吃到特殊食物后蛇身始终自洽
 * ================================================================== */
test('13.18 长时间随机对局含特殊食物：蛇身无重叠/脱节/出界', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  g.reset();
  g.state = h.STATE.PLAYING;

  const DIRS = ['up', 'down', 'left', 'right'];
  function safeDirs() {
    const head = g.snake[0];
    const cur = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
    const out = [];
    for (const name of DIRS) {
      const d = h.DIR[name];
      if (H.isOpposite(d, cur)) continue;
      const nx = head.x + d.x, ny = head.y + d.y;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      let hit = false;
      for (let i = 0; i < g.snake.length - 1; i++) {
        if (g.snake[i].x === nx && g.snake[i].y === ny) { hit = true; break; }
      }
      if (!hit) out.push(name);
    }
    return out;
  }

  for (let i = 0; i < 8000; i++) {
    if (g.state === h.STATE.GAMEOVER) { g.reset(); g.state = h.STATE.PLAYING; }
    // 主动塞特殊食物，制造高频触发
    if (!g.special && Math.random() < 0.05) {
      const types = ['gold', 'ice', 'bonus'];
      g.spawnSpecial(types[(Math.random() * 3) | 0]);
    }
    const safe = safeDirs();
    const pick = safe.length ? safe[(Math.random() * safe.length) | 0] : DIRS[(Math.random() * 4) | 0];
    g.queueDirection(h.DIR[pick]);
    const r = g.tick();
    if (r !== 'dead' && r !== 'win') {
      assert.ok(!H.hasDuplicateCells(g.snake), `第 ${i} 步蛇身重叠`);
      assert.ok(H.isContiguous(g.snake), `第 ${i} 步蛇身脱节`);
      for (const s of g.snake) {
        assert.ok(s.x >= 0 && s.x < COLS && s.y >= 0 && s.y < ROWS, `第 ${i} 步出界`);
      }
    }
    // 特殊食物绝不压在蛇身上
    if (g.special) {
      const onBody = g.snake.some((s) => s.x === g.special.x && s.y === g.special.y);
      assert.ok(!onBody, `第 ${i} 步特殊食物压在蛇身上`);
    }
  }
});
