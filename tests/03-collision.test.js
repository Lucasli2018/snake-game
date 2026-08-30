/**
 * 运行：cd tests && node --test
 *
 * 03 - 碰撞判定
 * 覆盖：
 *   - 撞四面墙都触发 gameover，死因为 'wall'
 *   - 撞自己身体触发 gameover，死因为 'self'
 *   - 死因文案（UI.syncOverlay 生成的 HTML）与死因匹配
 *   - 蛇头追到蛇尾刚腾出的那一格属于**合法移动**，不是死亡
 *   - 但「会变长时再撞尾」必须死亡（尾巴不让位）
 *   - 死亡瞬间不修改蛇身（不会出现半截插进墙里）
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/** 用格子数组 [ [x,y], ... ] 摆一条蛇，并设置方向 / 食物 / 状态 */
function setup(h, cells, dirName, food) {
  const g = h.Game;
  g.snake = cells.map((c) => ({ x: c[0], y: c[1] }));
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR[dirName];
  g.dirQueue = [];
  g.food = food ? { x: food[0], y: food[1] } : { x: -5, y: -5 };  // 默认食物不在场上
  g.state = h.STATE.PLAYING;
  g.deathReason = '';
  g.win = false;
  // E 轮：每个用例都从「满生命 + 非免伤」开始，避免上一个用例的免伤残留到下个用例
  g.invincible = 0;
  g.lives = h.Config.START_LIVES;
  return g;
}

/* ================================================================== *
 * 1. 撞墙
 * ================================================================== */
test('03.1 四面墙都会判定死亡，死因为 wall', () => {
  const h = H.createHarness();
  const { COLS, ROWS } = h.Config;

  const cases = [
    { name: '左墙', cells: [[0, 5], [1, 5], [2, 5]], dir: 'left' },
    { name: '右墙', cells: [[COLS - 1, 5], [COLS - 2, 5], [COLS - 3, 5]], dir: 'right' },
    { name: '上墙', cells: [[5, 0], [5, 1], [5, 2]], dir: 'up' },
    { name: '下墙', cells: [[5, ROWS - 1], [5, ROWS - 2], [5, ROWS - 3]], dir: 'down' }
  ];

  for (const c of cases) {
    const g = setup(h, c.cells, c.dir);
    const r = g.tick();
    // E 轮：撞墙不再直接结束，而是扣 1 点生命 + 进入免伤
    assert.strictEqual(r, 'hit', `${c.name}：应判定受击（而非直接死亡）`);
    assert.strictEqual(g.deathReason, 'wall', `${c.name}：死因应为 wall，实际 ${g.deathReason}`);
    assert.strictEqual(g.lives, h.Config.START_LIVES - 1, `${c.name}：应剩 ${h.Config.START_LIVES - 1} 点生命`);
    assert.ok(g.invincible > 0, `${c.name}：受击后应进入免伤`);
  }
});

test('03.1b 生命扣光后才真正死亡（连续撞满 START_LIVES 次）', () => {
  const h = H.createHarness();
  const n = h.Config.START_LIVES;
  for (let i = 0; i < n - 1; i++) {
    const g = setup(h, [[0, 5], [1, 5], [2, 5]], 'left');
    g.lives = n - i;
    assert.strictEqual(g.tick(), 'hit', `剩 ${g.lives} 点时撞墙应只扣血`);
  }
  const g = setup(h, [[0, 5], [1, 5], [2, 5]], 'left');
  g.lives = 1;
  assert.strictEqual(g.tick(), 'dead', '只剩 1 点时再撞应结束');
  assert.strictEqual(g.lives, 0);
});

test('03.2 贴着墙滑行不算撞墙（边界 off-by-one）', () => {
  const h = H.createHarness();
  const { COLS, ROWS } = h.Config;

  // 蛇头在 x=1，沿上边界向上？不行。改为：蛇头贴右墙内侧向上走，x=COLS-1 合法
  const g = setup(h, [[COLS - 1, 3], [COLS - 1, 4], [COLS - 1, 5]], 'up');
  assert.strictEqual(g.tick(), 'move', 'x = COLS-1 是合法列，不该死');
  assert.deepStrictEqual(H.cellOf(g.snake[0]), { x: COLS - 1, y: 2 });

  // 蛇头走到 y=0 仍合法，再走一步才死
  const g2 = setup(h, [[COLS - 1, 1], [COLS - 1, 2], [COLS - 1, 3]], 'up');
  assert.strictEqual(g2.tick(), 'move', 'y=0 是合法行');
  assert.strictEqual(g2.snake[0].y, 0);
  assert.strictEqual(g2.tick(), 'hit', 'y=-1 越界，应扣 1 点生命');
  assert.strictEqual(g2.deathReason, 'wall');
});

test('03.3 受击瞬间蛇身不被挪出界（不会半个身子插进墙里）', () => {
  const h = H.createHarness();
  const g = setup(h, [[0, 5], [1, 5], [2, 5]], 'left');
  const before = H.snakeOf(g.snake);
  assert.strictEqual(g.tick(), 'hit');
  assert.deepStrictEqual(H.cellOf(g.snake[0]), before[0], '受击后蛇头必须停在原处，不能出界');
  assert.deepStrictEqual(H.snakeOf(g.snake), before, '初始长度下受击不收缩，蛇身应完全不动');
});

/* ================================================================== *
 * 2. 撞自己
 * ================================================================== */
test('03.4 咬到身体中段判定死亡，死因为 self', () => {
  const h = H.createHarness();
  // 蛇头 (5,5) 向右会撞到第 4 节 (6,5)（不是尾巴，尾巴是 (7,5)）
  const g = setup(h, [[5, 5], [5, 6], [6, 6], [6, 5], [7, 5]], 'right');
  const r = g.tick();
  assert.strictEqual(r, 'hit', 'E 轮：咬到自己应只扣 1 点生命');
  assert.strictEqual(g.deathReason, 'self', `死因应为 self，实际 ${g.deathReason}`);
});

test('03.5 咬到身体时蛇头不前进，蛇身只会收缩不会变长', () => {
  const h = H.createHarness();
  const g = setup(h, [[5, 5], [5, 6], [6, 6], [6, 5], [7, 5]], 'right');
  const before = H.snakeOf(g.snake);
  g.tick();
  assert.deepStrictEqual(H.cellOf(g.snake[0]), before[0], '受击后蛇头不能前进');
  assert.ok(g.snake.length <= before.length, '受击后蛇身只能收缩，不能变长');
  assert.strictEqual(g.snake.length,
    Math.max(h.Config.START_LEN, before.length - h.Config.HIT_SHRINK),
    '受击后应恰好收缩 HIT_SHRINK 节（保底 START_LEN）');
});

test('03.6 死因文案：wall 与 self 分别给出不同提示', () => {
  const h = H.createHarness();

  // --- 撞墙 ---
  const g = setup(h, [[0, 5], [1, 5], [2, 5]], 'left');
  g.tick();
  h.Game.gameOver();
  h.UI.syncOverlay();
  let html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('撞到墙壁'), '撞墙文案缺失，实际面板：' + html.slice(0, 160));
  assert.ok(!html.includes('咬到自己'), '撞墙时不该出现"咬到自己"文案');

  // --- 咬到自己 ---
  const g2 = setup(h, [[5, 5], [5, 6], [6, 6], [6, 5], [7, 5]], 'right');
  g2.tick();
  h.Game.gameOver();
  h.UI.syncOverlay();
  html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('咬到自己'), '咬到自己文案缺失，实际面板：' + html.slice(0, 160));
  assert.ok(!html.includes('撞到墙壁'), '咬到自己时不该出现"撞到墙壁"文案');

  // --- 通关 ---
  h.Game.win = true;
  h.UI.syncOverlay();
  html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('通关'), '通关文案缺失');
  h.Game.win = false;
});

/* ================================================================== *
 * 3. 追尾巴 —— 合法移动
 * ================================================================== */
test('03.7 蛇头追到蛇尾刚腾出的那一格 = 合法移动，不是死亡', () => {
  const h = H.createHarness();
  // 2x2 环形：头 (5,5)，尾 (6,5)。头向右走进 (6,5)，尾巴本 tick 会让开
  const g = setup(h, [[5, 5], [5, 6], [6, 6], [6, 5]], 'right');

  const r = g.tick();
  assert.strictEqual(r, 'move', `追尾应判为合法移动，实际 ${r}（死因 ${g.deathReason}）`);
  assert.deepStrictEqual(H.cellOf(g.snake[0]), { x: 6, y: 5 }, '蛇头应进入原尾巴格');
  assert.strictEqual(g.snake.length, 4, '长度不变');
  assert.ok(!H.hasDuplicateCells(g.snake), '移动后蛇身不能有重叠');
  assert.ok(H.isContiguous(g.snake), '移动后蛇身必须连续');
});

test('03.8 紧贴尾巴绕圈跑 20 步都不会死', () => {
  const h = H.createHarness();
  const g = setup(h, [[5, 5], [5, 6], [6, 6], [6, 5]], 'right');
  const seq = ['right', 'down', 'left', 'up'];
  for (let i = 0; i < 20; i++) {
    const want = seq[i % 4];
    g.queueDirection(h.DIR[want]);
    const r = g.tick();
    assert.notStrictEqual(r, 'dead', `第 ${i + 1} 步绕圈死亡（${g.deathReason}）`);
    assert.ok(!H.hasDuplicateCells(g.snake), `第 ${i + 1} 步蛇身重叠`);
  }
  assert.strictEqual(g.snake.length, 4);
});

test('03.9 吃食物也是等长移动：追到尾格（恰好是食物）仍是合法吃食，蛇长不变', () => {
  const h = H.createHarness();
  // 2x2 环，尾格 (6,5) 上放食物。吃食物等长移动（尾巴让位），不算撞身
  const g = setup(h, [[5, 5], [5, 6], [6, 6], [6, 5]], 'right', [6, 5]);
  const r = g.tick();
  assert.strictEqual(r, 'eat', '吃到尾巴格上的食物应判为吃食（等长移动，尾巴让位）');
  assert.strictEqual(g.snake.length, 4, '吃食物不再变长，长度应保持不变');
  assert.ok(!H.hasDuplicateCells(g.snake), '吃食后蛇身不能有重叠');
});

/* ================================================================== *
 * 4. 端到端：走 App 主循环
 * ================================================================== */
test('03.10 端到端：撞墙后进入 gameover 并结算最高分，overlay 显示出来', () => {
  const h = H.createHarness();
  h.startPlaying();
  const g = h.Game;

  // 把蛇挪到贴着左墙、朝左走
  g.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR.left;
  g.dirQueue = [];
  g.score = 120;
  g.best = 0;

  h.pumpFrames(24);          // 累计 >400ms(慢速 interval≈235ms)，确保推进 tick 撞墙

  // E 轮：此时只是受击（扣 1 点生命），要撞满生命数才真正结束
  assert.strictEqual(g.lives, h.Config.START_LIVES - 1, '第一次撞墙应只扣 1 点生命');
  assert.strictEqual(g.deathReason, 'wall');
  H.killPlayer(h);           // 继续受击直到生命扣光，走真实的 Game.hit + App.endGame

  assert.strictEqual(g.state, h.STATE.GAMEOVER, '应进入 gameover');
  assert.strictEqual(g.deathReason, 'wall');
  assert.strictEqual(g.best, 120, '最高分应被更新');
  assert.strictEqual(g.isRecord, true);
  assert.strictEqual(h.els.get('overlay').hidden, false, '结束遮罩应显示');
  assert.ok(h.els.get('panel').innerHTML.includes('撞到墙壁'));
});

test('03.11 端到端：gameover 后继续推进帧不会抛异常、不会复活', () => {
  const h = H.createHarness();
  h.startPlaying();
  const g = h.Game;
  g.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR.left;
  g.dirQueue = [];
  h.pumpFrames(24);
  H.killPlayer(h);           // E 轮：撞满生命才结束
  assert.strictEqual(g.state, h.STATE.GAMEOVER);

  const snapshot = H.snakeOf(g.snake);
  const ticksBefore = h.tickCount();
  assert.doesNotThrow(() => h.pumpFrames(30), 'gameover 后继续渲染不应抛异常');
  assert.strictEqual(h.tickCount(), ticksBefore, 'gameover 后不应再推进逻辑步');
  assert.deepStrictEqual(H.snakeOf(g.snake), snapshot, 'gameover 后蛇身不应变化');
});

/* ================================================================== *
 * 5. 随机对局中的一致性
 * ================================================================== */
test('03.12 随机对局 3 万步：死亡时死因必为 wall 或 self，且蛇身始终自洽', () => {
  const h = H.createHarness();
  const { COLS, ROWS } = h.Config;
  const g = h.Game;
  let wall = 0;
  let self = 0;
  let hits = 0;
  let maxLen = 0;

  g.reset();
  g.state = h.STATE.PLAYING;

  const DIRS = ['up', 'down', 'left', 'right'];
  for (let i = 0; i < 30000; i++) {
    g.queueDirection(h.DIR[DIRS[(Math.random() * 4) | 0]]);   // 随机方向，制造死亡以覆盖 wall/self 死因
    const r = g.tick();
    maxLen = Math.max(maxLen, g.snake.length);
    // E 轮：免伤计时由主循环的 updateTimers(dt) 推进，这里按真实 tick 间隔手动推进，
    // 否则免伤永不到期，蛇会一直穿透而永远撞不死。
    g.updateTimers(1 / g.tps());

    // E 轮：受击只扣 1 点生命，对局继续
    if (r === 'hit') {
      assert.ok(g.deathReason === 'wall' || g.deathReason === 'self',
        `第 ${i} 步受击死因非法：${g.deathReason}`);
      assert.ok(g.lives > 0, `第 ${i} 步受击后生命应仍大于 0`);
      assert.ok(g.invincible > 0, `第 ${i} 步受击后应进入免伤`);
      hits++;
      continue;
    }

    if (r === 'dead') {
      assert.strictEqual(g.lives, 0, `第 ${i} 步死亡时生命应为 0`);
      assert.ok(g.deathReason === 'wall' || g.deathReason === 'self',
        `第 ${i} 步死因非法：${g.deathReason}`);
      if (g.deathReason === 'wall') wall++; else self++;

      // 复核死因：撞墙的话蛇头下一步确实越界
      const head = g.snake[0];
      const nx = head.x + g.dir.x;
      const ny = head.y + g.dir.y;
      const out = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS;
      assert.strictEqual(out, g.deathReason === 'wall',
        `第 ${i} 步死因与实际不符（越界=${out}，死因=${g.deathReason}）`);

      g.reset();
      g.state = h.STATE.PLAYING;
      continue;
    }
    if (r === 'win') { g.reset(); g.state = h.STATE.PLAYING; continue; }

    // 脱节任何时候都不允许；重叠只在免伤期间允许（免伤可穿过自己的身体）
    assert.ok(H.isContiguous(g.snake), `第 ${i} 步蛇身脱节`);
    if (g.invincible <= 0) {
      assert.ok(!H.hasDuplicateCells(g.snake), `第 ${i} 步蛇身重叠`);
    }
  }
  // 随机方向驱动下蛇会频繁撞墙或咬到自己，用于验证两种死因判定与蛇身自洽
  assert.ok(wall > 0 || self > 0, `3 万步应至少发生一次合法死亡（wall=${wall}, self=${self}）`);
  assert.ok(hits > 0, `E 轮后应出现大量受击而非一撞即死（受击 ${hits} 次）`);
  assert.strictEqual(maxLen, h.Config.START_LEN,
    `非闯关模式下吃食物不变长，蛇长应恒为初始长度 ${h.Config.START_LEN}（实际 ${maxLen}）`);
});
