/**
 * 运行：cd tests && node --test
 *
 * 01 - 反向自杀防护（最高优先级）
 * 覆盖：
 *   - 同一帧内连按 上→下 / 左→右 绝不允许 180° 掉头
 *   - 方向缓冲队列上限 3，队列满后入队必须被拒
 *   - 穷举所有长度 <=4 的按键序列（4 + 16 + 64 + 256 = 340 种）
 *   - 3 万次随机「连按 + 推进」模糊测试，断言蛇身永不重叠、永不脱节
 *   - 端到端走真实 keydown 事件（不只是直接调 queueDirection）
 *
 * 注意：Game 对象跑在 vm 沙箱里，其 Object.prototype 与宿主不同，
 * 所以比较坐标一律用 H.cellOf() 转成宿主普通对象再 deepStrictEqual。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const DIRS = ['up', 'down', 'left', 'right'];

/** 把游戏复位到一个已知的 playing 态，并把食物挪到蛇够不着的地方 */
function freshGame(h, startDir) {
  h.Game.reset();
  h.Game.state = h.STATE.PLAYING;
  h.Game.food = { x: 23, y: 23 };          // 远离出发区，避免测试中意外吃到
  if (startDir) h.Game.dir = h.DIR[startDir];
  return h.Game;
}

/** 一帧一帧推进，直到恰好又发生了 n 个 tick（避免"一帧里跑了两步"的误判） */
function pumpUntilTick(h, n) {
  const target = h.tickCount() + n;
  let guard = 0;
  while (h.tickCount() < target && guard++ < 1000) h.pump();
  assert.strictEqual(h.tickCount(), target, `没能推进到 ${n} 个 tick`);
}

function head(g) { return H.cellOf(g.snake[0]); }

/* ================================================================== *
 * 1. 基本拒绝规则
 * ================================================================== */
test('01.1 与当前方向相同 / 相反的按键都应被忽略', () => {
  const h = H.createHarness();
  const g = freshGame(h);                       // g.dir === right

  assert.strictEqual(h.Game.queueDirection(h.DIR.right), false, '同向按键应被忽略');
  assert.strictEqual(h.Game.dirQueue.length, 0);

  assert.strictEqual(h.Game.queueDirection(h.DIR.left), false, '反向按键应被忽略（right→left）');
  assert.strictEqual(h.Game.dirQueue.length, 0, '反向按键不能入队');

  assert.strictEqual(h.Game.queueDirection(h.DIR.up), true, '垂直转向应被接受');
  assert.strictEqual(h.Game.dirQueue.length, 1);
});

test('01.2 同一帧内连按 上→下：第二次必须被拒，蛇只能向上走', () => {
  const h = H.createHarness();
  const g = freshGame(h);                       // dir = right，蛇 [(12,12),(11,12),(10,12)]

  assert.strictEqual(g.queueDirection(h.DIR.up), true, '第 1 次按「上」应入队');
  assert.strictEqual(g.queueDirection(h.DIR.down), false, '第 2 次按「下」必须被拒（与队尾 up 相反）');
  assert.strictEqual(g.dirQueue.length, 1, '队列里只应有 1 个方向');

  const r = g.tick();
  assert.strictEqual(r, 'move');
  assert.deepStrictEqual(head(g), { x: 12, y: 11 }, '蛇头必须向上移动一格，不能掉头向下');
  assert.deepStrictEqual(H.cellOf(g.snake[1]), { x: 12, y: 12 }, '原蛇头应变成第 2 节');
  assert.ok(!H.hasDuplicateCells(g.snake), '蛇身不能出现重叠格子');
});

test('01.3 同一帧内连按 左→右（当前方向为 up）：第二次必须被拒', () => {
  const h = H.createHarness();
  const g = freshGame(h);                       // dir = right
  // 先向上走一步，让蛇身处在蛇头下方，此时左右转都不会撞到身体
  g.queueDirection(h.DIR.up);
  g.tick();
  assert.deepStrictEqual(head(g), { x: 12, y: 11 });
  assert.strictEqual(g.dir, h.DIR.up);

  assert.strictEqual(g.queueDirection(h.DIR.left), true, 'up → left 合法');
  assert.strictEqual(g.queueDirection(h.DIR.right), false, 'right 与队尾 left 相反，必须被拒');
  assert.strictEqual(g.dirQueue.length, 1);

  const r = g.tick();
  assert.strictEqual(r, 'move');
  assert.deepStrictEqual(head(g), { x: 11, y: 11 }, '蛇头必须向左，不能向右');
  assert.ok(!H.hasDuplicateCells(g.snake));
});

test('01.4 连按 上→下→左 后执行 3 步：ydown 被丢弃，不会反向穿身', () => {
  const h = H.createHarness();
  const g = freshGame(h);
  g.queueDirection(h.DIR.up);      // 入队
  g.queueDirection(h.DIR.down);    // 拒绝（与 up 反向）
  g.queueDirection(h.DIR.left);    // 入队
  assert.strictEqual(g.dirQueue.length, 2, '实际生效的只有 [up, left]');

  // 3 个 tick：up → left → left（队列空后保持最后方向）
  for (let i = 0; i < 3; i++) {
    const r = g.tick();
    assert.notStrictEqual(r, 'dead', `第 ${i + 1} 步不应死亡，实际死因 ${g.deathReason}`);
    assert.ok(!H.hasDuplicateCells(g.snake), `第 ${i + 1} 步蛇身出现重叠`);
    assert.ok(H.isContiguous(g.snake), `第 ${i + 1} 步蛇身脱节`);
  }
  assert.deepStrictEqual(head(g), { x: 10, y: 11 }, 'up(12,11) → left(11,11) → left(10,11)');
});

/* ================================================================== *
 * 2. 队列上限
 * ================================================================== */
test('01.5 队列上限为 MAX_QUEUED_DIRS(3)，满后入队一律被拒', () => {
  const h = H.createHarness();
  const g = freshGame(h);                        // dir = right
  const cap = h.Config.MAX_QUEUED_DIRS;
  assert.strictEqual(cap, 3);

  // right → up → left → down 是合法序列（相邻两步都不反向）
  assert.strictEqual(g.queueDirection(h.DIR.up), true);
  assert.strictEqual(g.queueDirection(h.DIR.left), true);
  assert.strictEqual(g.queueDirection(h.DIR.down), true);
  assert.strictEqual(g.dirQueue.length, 3, '队列应已满');

  // 队列满后：再入队任何方向（哪怕是"合法"的）都必须返回 false
  assert.strictEqual(g.queueDirection(h.DIR.up), false, '队列满 + 反向 → 拒绝');
  assert.strictEqual(g.queueDirection(h.DIR.left), false, '队列满 + 合法方向 → 也应拒绝');
  assert.strictEqual(g.queueDirection(h.DIR.right), false);
  assert.strictEqual(g.dirQueue.length, 3, '被拒的入队不能改变队列长度');
});

test('01.6 队列满后再猛按 20 次，长度不会超过上限', () => {
  const h = H.createHarness();
  const g = freshGame(h);
  for (let i = 0; i < 20; i++) {
    g.queueDirection(h.DIR[DIRS[i % 4]]);
  }
  assert.ok(g.dirQueue.length <= h.Config.MAX_QUEUED_DIRS,
    `队列长度 ${g.dirQueue.length} 超过上限 ${h.Config.MAX_QUEUED_DIRS}`);
});

test('01.7 队列排空过程中每一步都不会出现 180° 掉头', () => {
  const h = H.createHarness();
  const g = freshGame(h);
  g.queueDirection(h.DIR.up);
  g.queueDirection(h.DIR.left);
  g.queueDirection(h.DIR.down);
  assert.strictEqual(g.dirQueue.length, 3);

  let prev = H.cellOf(g.dir);
  for (let i = 0; i < 3; i++) {
    g.tick();
    assert.ok(!H.isOpposite(prev, H.cellOf(g.dir)), `第 ${i + 1} 步出现 180° 掉头`);
    assert.notStrictEqual(g.deathReason, 'self', `第 ${i + 1} 步咬到自己`);
    prev = H.cellOf(g.dir);
  }
  // right → up(12,11) → left(11,11) → down(11,12)
  assert.deepStrictEqual(head(g), { x: 11, y: 12 });
});

/* ================================================================== *
 * 3. 穷举所有按键序列
 * ================================================================== */
function genCombos(maxLen) {
  const out = [];
  (function walk(prefix, depth) {
    if (depth === 0) { out.push(prefix.slice()); return; }
    for (const d of DIRS) { prefix.push(d); walk(prefix, depth - 1); prefix.pop(); }
  })([], maxLen);
  return out;
}

test('01.8 穷举长度 1~4 的全部 340 种按键序列：永不掉头 / 永不自撞', () => {
  const h = H.createHarness();
  const combos = [].concat(genCombos(1), genCombos(2), genCombos(3), genCombos(4));
  assert.strictEqual(combos.length, 4 + 16 + 64 + 256);

  let cases = 0;
  for (const combo of combos) {
    const g = freshGame(h);                       // dir = right，蛇 [(12,12),(11,12),(10,12)]
    for (const d of combo) g.queueDirection(h.DIR[d]);
    assert.ok(g.dirQueue.length <= h.Config.MAX_QUEUED_DIRS, '队列越界');

    let prev = H.cellOf(g.dir);
    for (let i = 0; i < combo.length; i++) {
      const r = g.tick();
      assert.notStrictEqual(r, 'dead',
        `序列 [${combo.join(',')}] 第 ${i + 1} 步死亡（${g.deathReason}）`);
      assert.ok(!H.isOpposite(prev, H.cellOf(g.dir)),
        `序列 [${combo.join(',')}] 第 ${i + 1} 步 180° 掉头`);
      assert.ok(!H.hasDuplicateCells(g.snake),
        `序列 [${combo.join(',')}] 第 ${i + 1} 步蛇身重叠`);
      assert.ok(H.isContiguous(g.snake),
        `序列 [${combo.join(',')}] 第 ${i + 1} 步蛇身脱节`);
      prev = H.cellOf(g.dir);
    }
    cases++;
  }
  assert.strictEqual(cases, 340);
});

/* ================================================================== *
 * 4. 模糊测试
 * ================================================================== */
test('01.9 3 万次随机「连按 + 推进」模糊测试：蛇身永不重叠、永不脱节', () => {
  const h = H.createHarness();
  const g = freshGame(h);
  let deaths = 0;
  let queueRejects = 0;

  for (let i = 0; i < 30000; i++) {
    if (Math.random() < 0.55) {
      const d = h.DIR[DIRS[(Math.random() * 4) | 0]];
      if (!g.queueDirection(d)) queueRejects++;
    } else {
      const r = g.tick();
      if (r === 'dead') {
        deaths++;
        assert.ok(!H.hasDuplicateCells(g.snake), `第 ${i} 次迭代：死亡时蛇身已重叠`);
        freshGame(h);
        continue;
      }
      assert.ok(!H.hasDuplicateCells(g.snake),
        `第 ${i} 次迭代：蛇身出现重叠 ${JSON.stringify(H.snakeOf(g.snake).slice(0, 6))}`);
      assert.ok(H.isContiguous(g.snake), `第 ${i} 次迭代：蛇身脱节`);
    }
  }
  // 确认测试确实在施加压力，而不是空转
  assert.ok(queueRejects > 1000, `被拒输入数 ${queueRejects} 偏少，测试可能没有真正施加压力`);
  assert.ok(deaths > 0, '3 万次迭代里一次都没撞墙，随机驱动可能有问题');
});

/* ================================================================== *
 * 5. 端到端：真实 keydown 事件
 * ================================================================== */
test('01.10 端到端：同一帧内真实按下 ↑ 再按 ↓，蛇不会反向穿身', () => {
  const h = H.createHarness();
  h.startPlaying();                              // 真实走 App.start()
  const g = h.Game;
  assert.strictEqual(g.state, h.STATE.PLAYING);

  h.key('ArrowUp');
  h.key('ArrowDown');                            // 同一帧、未推进任何 tick
  assert.strictEqual(g.dirQueue.length, 1, '↓ 不应入队');

  const before = head(g);
  pumpUntilTick(h, 1);
  assert.deepStrictEqual(head(g), { x: before.x, y: before.y - 1 }, '蛇头必须向上，不能向下');
  assert.ok(!H.hasDuplicateCells(g.snake));
});

test('01.11 端到端：一帧内连按 ↑ ↓ ← → 四次，只有合法序列生效', () => {
  const h = H.createHarness();
  h.startPlaying();
  const g = h.Game;

  h.key('ArrowUp');    // 合法：right → up
  h.key('ArrowDown');  // 拒绝：与 up 反向
  h.key('ArrowLeft');  // 合法：up → left
  h.key('ArrowRight'); // 拒绝：与 left 反向
  assert.strictEqual(g.dirQueue.length, 2, '应只入队 [up, left]');

  pumpUntilTick(h, 1);
  const p1 = head(g);
  assert.deepStrictEqual(p1, { x: 12, y: 11 }, '第一步应向上');

  pumpUntilTick(h, 1);
  const p2 = head(g);
  assert.deepStrictEqual(p2, { x: p1.x - 1, y: p1.y }, '第二步应向左');
  assert.ok(!H.hasDuplicateCells(g.snake));
});

test('01.12 非 playing 状态下按键不入队（ready / paused / gameover）', () => {
  const h = H.createHarness();
  const g = h.Game;

  g.state = h.STATE.READY;
  assert.strictEqual(g.queueDirection(h.DIR.up), false);
  g.state = h.STATE.PAUSED;
  assert.strictEqual(g.queueDirection(h.DIR.up), false);
  g.state = h.STATE.GAMEOVER;
  assert.strictEqual(g.queueDirection(h.DIR.up), false);
  assert.strictEqual(g.dirQueue.length, 0, '非 playing 态绝不能入队');
});

test('01.13 WASD 与方向键等价，且同样防反向', () => {
  const h = H.createHarness();
  h.startPlaying();
  const g = h.Game;

  h.key('w');                                    // up
  h.key('s');                                    // down —— 应被拒
  assert.strictEqual(g.dirQueue.length, 1);
  pumpUntilTick(h, 1);
  assert.strictEqual(g.snake[0].y, 11, 'W 应让蛇头向上');
});

test('01.14 移动端滑动同样走防反向逻辑', () => {
  const h = H.createHarness();
  h.startPlaying();
  const g = h.Game;

  h.swipe(0, -80);      // 向上滑
  h.swipe(0, 80);       // 同一帧反向滑 —— 应被拒
  assert.strictEqual(g.dirQueue.length, 1, '反向滑动不应入队');

  const before = head(g);
  pumpUntilTick(h, 1);
  assert.deepStrictEqual(head(g), { x: before.x, y: before.y - 1 }, '应向上走，不能向下');
});
