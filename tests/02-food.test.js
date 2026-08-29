/**
 * 运行：cd tests && node --test
 *
 * 02 - 食物生成
 * 覆盖：
 *   - 数千次随机验证：食物绝不落在蛇身占据的格子上
 *   - 食物坐标恒在棋盘内、且是整数
 *   - 空格数为 1 / 2 / k 时的取值正确性与分布
 *   - 棋盘被蛇填满时：placeFood 返回 false、food 置为哨兵值、不会死循环
 *   - 通关（win）分支真的可达：构造哈密顿路径把棋盘吃到只剩一格
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/** 随机生成 n 个互不相同的格子 */
function randomCells(n, cols, rows, rnd) {
  const used = new Set();
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 50) {
    const x = Math.floor(rnd() * cols);
    const y = Math.floor(rnd() * rows);
    const k = y * cols + x;
    if (used.has(k)) continue;
    used.add(k);
    out.push({ x, y });
  }
  return out;
}

/** 24x24 棋盘上的一条哈密顿路径（蛇形来回扫描），相邻两格必定相邻 */
function hamiltonianPath(cols, rows) {
  const p = [];
  for (let y = 0; y < rows; y++) {
    if (y % 2 === 0) for (let x = 0; x < cols; x++) p.push({ x, y });
    else for (let x = cols - 1; x >= 0; x--) p.push({ x, y });
  }
  return p;
}

/* ================================================================== *
 * 1. 随机验证零重叠
 * ================================================================== */
test('02.1 5000 次随机蛇身 + 随机长度：食物绝不落在蛇身上', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const total = COLS * ROWS;
  let rndState = 12345;
  const rnd = () => (rndState = (rndState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let trial = 0; trial < 5000; trial++) {
    const len = 1 + Math.floor(rnd() * (total - 1));
    g.snake = randomCells(len, COLS, ROWS, rnd);
    const ok = g.placeFood();
    assert.strictEqual(ok, true, `第 ${trial} 次：还有空格却返回 false`);

    const f = g.food;
    assert.ok(Number.isInteger(f.x) && Number.isInteger(f.y), '食物坐标必须是整数');
    assert.ok(f.x >= 0 && f.x < COLS && f.y >= 0 && f.y < ROWS,
      `食物坐标越界 (${f.x},${f.y})`);

    const onBody = g.snake.some((s) => s.x === f.x && s.y === f.y);
    assert.ok(!onBody,
      `第 ${trial} 次：食物 (${f.x},${f.y}) 落在了蛇身上（蛇长 ${len}）`);
  }
});

test('02.2 逐格穷举：蛇占据除 1 格外的全部棋盘时，食物必然是那一格', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const total = COLS * ROWS;

  for (const hole of [0, 1, 5, 100, 275, total - 2, total - 1]) {
    const snake = [];
    for (let i = 0; i < total; i++) {
      if (i === hole) continue;
      snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
    }
    g.snake = snake;
    assert.strictEqual(g.placeFood(), true);
    assert.deepStrictEqual(H.cellOf(g.food),
      { x: hole % COLS, y: Math.floor(hole / COLS) },
      `唯一空格 #${hole} 应被选中`);
  }
});

test('02.3 只剩 2 个空格时，两个空格都会被取到（随机性没有被写死）', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const total = COLS * ROWS;
  const hits = new Map();

  for (let t = 0; t < 3000; t++) {
    const snake = [];
    for (let i = 0; i < total; i++) {
      if (i === 7 || i === 300) continue;
      snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
    }
    g.snake = snake;
    g.placeFood();
    const key = g.food.y * COLS + g.food.x;
    hits.set(key, (hits.get(key) || 0) + 1);
  }
  assert.strictEqual(hits.size, 2, '两个候选空格都应该出现');
  for (const [k, v] of hits) {
    assert.ok(v > 3000 * 0.35, `空格 #${k} 只出现了 ${v} 次，分布严重偏斜`);
  }
});

test('02.4 空格数为 k 时，食物在 k 个空格上的分布大致均匀', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const total = COLS * ROWS;
  const FREE = 40;
  const counts = new Array(FREE).fill(0);

  const snake = [];
  for (let i = FREE; i < total; i++) snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
  g.snake = snake;

  const N = 20000;
  for (let t = 0; t < N; t++) {
    g.placeFood();
    const k = g.food.y * COLS + g.food.x;
    assert.ok(k >= 0 && k < FREE, `取到了非空格 #${k}`);
    counts[k]++;
  }
  const expected = N / FREE;
  for (let i = 0; i < FREE; i++) {
    assert.ok(counts[i] > expected * 0.5 && counts[i] < expected * 1.5,
      `空格 #${i} 出现 ${counts[i]} 次，偏离期望 ${expected} 太远`);
  }
});

/* ================================================================== *
 * 2. 满盘兜底
 * ================================================================== */
test('02.5 棋盘被填满：placeFood 返回 false、food 置为 (-1,-1)、同步返回不死循环', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const total = COLS * ROWS;

  const snake = [];
  for (let i = 0; i < total; i++) snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
  g.snake = snake;

  const t0 = Date.now();
  assert.strictEqual(g.placeFood(), false, '满盘时应返回 false');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `满盘分支耗时 ${elapsed}ms，疑似死循环`);
  assert.deepStrictEqual(H.cellOf(g.food), { x: -1, y: -1 }, '满盘时 food 应为哨兵值');
});

test('02.6 满盘时再次调用 placeFood 依然是 false（幂等，不卡死）', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;
  const snake = [];
  for (let i = 0; i < COLS * ROWS; i++) snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
  g.snake = snake;
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(g.placeFood(), false);
  }
});

test('02.7 满盘时渲染不画食物（drawFood 会提前 return），整帧渲染不抛异常', () => {
  const h = H.createHarness();
  const { COLS, ROWS } = h.Config;
  const snake = [];
  for (let i = 0; i < COLS * ROWS; i++) snake.push({ x: i % COLS, y: Math.floor(i / COLS) });
  h.Game.snake = snake;
  h.Game.placeFood();
  assert.strictEqual(h.Game.food.x, -1);
  assert.doesNotThrow(() => h.Renderer.render(0.5), 'food 为哨兵值时渲染不应抛异常');
});

/* ================================================================== *
 * 3. 通关分支真的可达
 * ================================================================== */
test('02.8 吃到最后一颗食物时 tick() 返回 win，且不会死循环', () => {
  const h = H.createHarness();
  const g = h.Game;
  const { COLS, ROWS } = h.Config;

  // 沿哈密顿路径摆满棋盘，只留 P[0] = (0,0) 这一格给食物
  const P = hamiltonianPath(COLS, ROWS);
  assert.strictEqual(P.length, COLS * ROWS);

  // 自证：路径相邻两格曼哈顿距离恒为 1，且覆盖全部格子（无重复）
  const seen = new Set();
  for (let i = 0; i < P.length; i++) {
    const k = P[i].y * COLS + P[i].x;
    assert.ok(!seen.has(k), '哈密顿路径出现重复格子');
    seen.add(k);
    if (i > 0) {
      const d = Math.abs(P[i].x - P[i - 1].x) + Math.abs(P[i].y - P[i - 1].y);
      assert.strictEqual(d, 1, `路径第 ${i} 步不连续`);
    }
  }

  // snake[i] = P[i+1]，即蛇头在 P[1]=(1,0)，身体沿路径延伸到 P[575]
  g.snake = P.slice(1).map((c) => ({ x: c.x, y: c.y }));
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.food = { x: P[0].x, y: P[0].y };      // (0,0)
  g.dir = h.DIR.left;                      // (1,0) → (0,0)
  g.state = h.STATE.PLAYING;
  g.score = (COLS * ROWS - 4) * h.Config.SCORE_PER_FOOD;

  const t0 = Date.now();
  const r = g.tick();
  const elapsed = Date.now() - t0;

  assert.strictEqual(r, 'win', `期望返回 win，实际 ${r}`);
  assert.ok(elapsed < 1000, `tick 耗时 ${elapsed}ms，疑似死循环`);
  assert.strictEqual(g.win, true, 'win 标记应置位');
  assert.strictEqual(g.snake.length, COLS * ROWS, '蛇应占满整个棋盘');
  assert.ok(!H.hasDuplicateCells(g.snake), '通关瞬间蛇身不能有重叠');
});

test('02.9 通关后游戏状态机正确切换到 gameover，并写入最高分', () => {
  const h = H.createHarness();
  const { COLS, ROWS } = h.Config;
  const P = hamiltonianPath(COLS, ROWS);
  const g = h.Game;

  g.snake = P.slice(1).map((c) => ({ x: c.x, y: c.y }));
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.food = { x: P[0].x, y: P[0].y };
  g.dir = h.DIR.left;
  g.state = h.STATE.PLAYING;
  g.score = 5000;
  g.best = 0;

  // 直接驱动主循环（App.frame），验证 win 分支的完整处理链路
  h.App.accumulator = 1e9;                 // 强制本帧就推进
  h.pump();

  assert.strictEqual(g.state, h.STATE.GAMEOVER, '通关后应进入 gameover');
  assert.strictEqual(g.best, 5010, '通关得分应写入最高分');
  assert.strictEqual(g.isRecord, true);
  assert.doesNotThrow(() => h.pump(), 'gameover 后继续渲染不应抛异常');
});

/* ================================================================== *
 * 4. 正常对局中食物永不与蛇身重合
 * ================================================================== */
test('02.10 长时间随机对局：任意时刻食物都不在蛇身上', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.reset();
  g.state = h.STATE.PLAYING;

  const DIRS = ['up', 'down', 'left', 'right'];
  const { COLS, ROWS } = h.Config;

  /** 列出"不会立刻撞墙 / 撞身 / 反向"的方向，让蛇能活得久一点 */
  function safeDirs() {
    const head = g.snake[0];
    const cur = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
    const out = [];
    for (const name of DIRS) {
      const d = h.DIR[name];
      if (H.isOpposite(d, cur)) continue;
      const nx = head.x + d.x;
      const ny = head.y + d.y;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      let hits = false;
      for (let i = 0; i < g.snake.length - 1; i++) {
        if (g.snake[i].x === nx && g.snake[i].y === ny) { hits = true; break; }
      }
      if (hits) continue;
      out.push(name);
    }
    return out;
  }

  let eats = 0;
  let maxLen = 0;
  for (let i = 0; i < 20000; i++) {
    const safe = safeDirs();
    let pick;
    if (safe.length === 0) {
      pick = DIRS[(Math.random() * 4) | 0];
    } else {
      // 70% 概率朝食物走，30% 随机，保证既能吃到又不至于一直原地打转
      const dx = g.food.x - g.snake[0].x;
      const dy = g.food.y - g.snake[0].y;
      const prefer = safe.filter((n) => {
        const d = h.DIR[n];
        return (dx !== 0 && d.x === Math.sign(dx)) || (dy !== 0 && d.y === Math.sign(dy));
      });
      pick = (prefer.length && Math.random() < 0.7)
        ? prefer[(Math.random() * prefer.length) | 0]
        : safe[(Math.random() * safe.length) | 0];
    }
    g.queueDirection(h.DIR[pick]);
    const r = g.tick();
    maxLen = Math.max(maxLen, g.snake.length);

    if (r === 'dead' || r === 'win') { g.reset(); g.state = h.STATE.PLAYING; continue; }
    if (r === 'eat') {
      eats++;
      assert.ok(!H.hasDuplicateCells(g.snake), `第 ${i} 步吃完后蛇身重叠`);
    }
    // 每一步之后食物都不能压在蛇身上
    if (g.food.x >= 0) {
      const overlap = g.snake.some((s) => s.x === g.food.x && s.y === g.food.y);
      assert.ok(!overlap,
        `第 ${i} 步后食物 (${g.food.x},${g.food.y}) 竟与蛇身重合（蛇长 ${g.snake.length}）`);
    }
  }
  assert.ok(eats > 500, `2 万步只吃到 ${eats} 颗食物，驱动可能有问题`);
  assert.ok(maxLen > 20, `最长只长到 ${maxLen} 节，压力不够（应能触发拥挤棋盘的生成路径）`);
});
