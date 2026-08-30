/**
 * 运行：cd tests && node --test
 *
 * 16 - F 轮：Boss 进化（血条 / 多形态 / 毒区地形）
 * 覆盖：
 *   - 撞中 Boss 尾节 = 攻击（Boss 扣血、玩家安全通过）；撞身体才受伤
 *   - Boss 血量归零：移除、加分、_lastBossHit.killed
 *   - 多形态：追猎者 / 分裂者 / 游猎者（冲刺 AI）
 *   - 分裂者被击破后炸出若干条会冲刺的小蛇
 *   - 毒区：Boss 关生成、踩中受击、漂移永不压到玩家与食物
 *   - 渲染：三形态 + 毒区 + 血条不抛异常
 *
 * 说明：全部走源码真实路径，不复制逻辑到测试里。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/** 开一局并置于 playing 态 */
function fresh(h) {
  h.App.start();
  return h.Game;
}

/** 把食物放到蛇头正前方并推进一步（必定吃到） */
function feedOnce(h) {
  const g = h.Game;
  const head = g.snake[0];
  const d = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
  g.food = { x: head.x + d.x, y: head.y + d.y };
  return g.tick();
}

/** 造一条指定形态的 Boss：head 是蛇头位置，身体沿 headDir 的反方向铺开 */
function makeBoss(h, head, len, kind, hp, headDir) {
  const d = headDir || h.DIR.right;
  const cells = [];
  for (let i = 0; i < len; i++) {
    // snake[0] 是头，身体落在头的后方（与 spawnBossAt 保持一致）
    cells.push({ x: head.x - d.x * i, y: head.y - d.y * i });
  }
  return {
    snake: cells,
    prevSnake: cells.map((c) => ({ x: c.x, y: c.y })),
    dir: d, acc: 0,
    hp: hp === undefined ? 3 : hp,
    maxHp: hp === undefined ? 3 : hp,
    kind: kind || 'chaser',
    dashTimer: 99, dashWarn: 0, dashTime: 0, dashDir: d, hitFlash: 0
  };
}

/** 把蛇摆成朝右、位于 (x,y) 的姿态 */
function placeSnake(h, x, y, dirName) {
  const g = h.Game;
  g.snake = [{ x: x, y: y }, { x: x - 1, y: y }, { x: x - 2, y: y }];
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR[dirName || 'right'];
  g.dirQueue = [];
  g.food = { x: 20, y: 20 };
  return g;
}

/* ================================================================== *
 * 1. 弱点与血条
 * ================================================================== */
test('16.1 bossAt：正确识别尾节与身体节', () => {
  const h = H.createHarness();
  const g = fresh(h);
  // 头在 (10,5)、朝右铺开 -> 身体 (9,5)，尾 (8,5)
  g.bosses = [makeBoss(h, { x: 10, y: 5 }, 3, 'chaser')];
  const tail = g.bossAt(8, 5);
  assert.ok(tail && tail.isTail, '(8,5) 应被识别为尾节');
  const body = g.bossAt(9, 5);
  assert.ok(body && !body.isTail, '(9,5) 应为身体节');
  const head = g.bossAt(10, 5);
  assert.ok(head && !head.isTail, '(10,5) 是头，也不该算弱点');
  assert.strictEqual(g.bossAt(3, 3), null, '空格应返回 null');
});

test('16.2 撞中尾节 = 攻击：Boss 扣血，玩家不扣命且能继续前进', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.stageMode = false;
  placeSnake(h, 5, 5, 'right');             // 前方是 (6,5)
  // 头在 (8,5)、朝右铺开 -> 尾节正好落在玩家前方的 (6,5)
  g.bosses = [makeBoss(h, { x: 8, y: 5 }, 3, 'chaser')];

  const lives = g.lives;
  const hp = g.bosses[0].hp;
  const r = g.tick();

  assert.strictEqual(g.bosses[0].hp, hp - 1, 'Boss 应扣 1 点血');
  assert.strictEqual(g.lives, lives, '玩家不应扣生命');
  assert.notStrictEqual(r, 'hit', '撞尾巴不该判定为受击');
  assert.deepStrictEqual(H.cellOf(g.snake[0]), { x: 6, y: 5 }, '玩家应安全移动到尾节格');
  assert.ok(g._lastBossHit, '应记录打击反馈供主循环消费');
  assert.strictEqual(g._lastBossHit.killed, false);
});

test('16.3 撞中身体节 = 受伤：玩家扣血，Boss 不掉血', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.stageMode = false;
  placeSnake(h, 5, 5, 'right');
  // 头正好在 (6,5)：玩家撞到的是头（非尾节）
  g.bosses = [makeBoss(h, { x: 6, y: 5 }, 3, 'chaser')];
  g.invincible = 0;

  const hp = g.bosses[0].hp;
  const r = g.tick();
  assert.strictEqual(r, 'hit', '撞身体应判定为受击');
  assert.strictEqual(g.deathReason, 'boss');
  assert.strictEqual(g.bosses[0].hp, hp, 'Boss 不应掉血');
  assert.strictEqual(g.lives, h.Config.START_LIVES - 1);
});

test('16.4 血量归零：Boss 移除 + 加分 + killed 标记', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.stageMode = false;
  placeSnake(h, 5, 5, 'right');
  g.bosses = [makeBoss(h, { x: 8, y: 5 }, 3, 'chaser', 1)];

  const scoreBefore = g.score;
  const r = g.tick();
  assert.notStrictEqual(r, 'hit');
  assert.strictEqual(g.bosses.length, 0, 'Boss 应被移除');
  assert.strictEqual(g._lastBossHit.killed, true);
  assert.strictEqual(g.score - scoreBefore, h.Config.BOSS_KILL_SCORE, '击破应加分');
});

test('16.5 击破得分吃「贪婪」倍率', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.stageMode = false;
  g.scoreMul = 1.3;
  placeSnake(h, 5, 5, 'right');
  g.bosses = [makeBoss(h, { x: 8, y: 5 }, 3, 'chaser', 1)];
  const before = g.score;
  g.tick();
  assert.strictEqual(g.score - before, Math.round(h.Config.BOSS_KILL_SCORE * 1.3));
});

/* ================================================================== *
 * 2. 多形态
 * ================================================================== */
test('16.6 形态分配：首个 Boss 关是追猎者，之后是分裂者', () => {
  const h = H.createHarness();
  const g = fresh(h);
  assert.strictEqual(g.bossKindFor(h.Config.BOSS_FIRST_STAGE), 'chaser');
  assert.strictEqual(g.bossKindFor(h.Config.BOSS_FIRST_STAGE + h.Config.BOSS_EVERY), 'splitter');
  assert.strictEqual(g.bossKindFor(1), 'chaser', '非 Boss 关兜底为追猎者');
  assert.strictEqual(g.bossStageIndex(h.Config.BOSS_FIRST_STAGE), 0);
  assert.strictEqual(g.bossStageIndex(h.Config.BOSS_FIRST_STAGE + h.Config.BOSS_EVERY), 1);
});

test('16.7 后面的 Boss 关血量更高、蛇更长', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;

  g.reset();
  g.stage = c.BOSS_FIRST_STAGE;
  const b1 = g.spawnBoss();
  assert.strictEqual(b1.hp, c.BOSS_HP_BASE);
  assert.strictEqual(b1.snake.length, c.BOSS_LEN);

  g.bosses = [];
  g.stage = c.BOSS_FIRST_STAGE + c.BOSS_EVERY;
  const b2 = g.spawnBoss();
  assert.strictEqual(b2.hp, c.BOSS_HP_BASE + c.BOSS_HP_STEP, '后续 Boss 关血量应递增');
  assert.strictEqual(b2.kind, 'splitter');
});

test('16.8 分裂者被击破：炸出若干条会冲刺的游猎者', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;
  g.reset();
  g.stage = c.BOSS_FIRST_STAGE + c.BOSS_EVERY;
  const b = g.spawnBoss();
  assert.strictEqual(b.kind, 'splitter');

  b.hp = 1;
  const tail = b.snake[b.snake.length - 1];
  g.damageBoss(b, tail.x, tail.y);

  assert.strictEqual(g.bosses.length, c.BOSS_SPLIT_COUNT, '应分裂出指定数量的小蛇');
  for (const s of g.bosses) {
    assert.strictEqual(s.kind, 'dasher', '分裂体应为游猎者');
    assert.strictEqual(s.hp, c.BOSS_SPLIT_HP);
    assert.strictEqual(s.snake.length, c.BOSS_SPLIT_LEN);
    assert.ok(H.isContiguous(s.snake), '分裂体蛇身必须连续');
    for (const seg of s.snake) {
      assert.ok(seg.x >= 0 && seg.x < c.COLS && seg.y >= 0 && seg.y < c.ROWS, '分裂体不得越界');
    }
  }
});

test('16.9 游猎者：待机 -> 预警 -> 冲刺，冲刺方向朝玩家', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;
  g.reset();
  const b = g.spawnBossAt(2, 2, 'dasher', c.BOSS_SPLIT_LEN, c.BOSS_SPLIT_HP);
  assert.ok(b, '应生成游猎者');

  // 待机 -> 预警（方向在预警那一刻锁定，之后 Boss 会移动，所以此刻就取基准）
  b.dashTimer = 0.05;
  const headAtWarn = H.cellOf(b.snake[0]);
  const me = g.snake[0];
  g.updateBoss(0.1);
  assert.ok(b.dashWarn > 0, '应先进入预警（给玩家反应时间）');
  assert.strictEqual(b.dashTime, 0, '预警期间还没开始冲');

  const warned = b.dashDir;
  const dx = me.x - headAtWarn.x, dy = me.y - headAtWarn.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    assert.strictEqual(warned.x, dx >= 0 ? 1 : -1, '冲刺方向应指向玩家（横轴）');
    assert.strictEqual(warned.y, 0);
  } else {
    assert.strictEqual(warned.y, dy >= 0 ? 1 : -1, '冲刺方向应指向玩家（纵轴）');
    assert.strictEqual(warned.x, 0);
  }

  // 预警结束 -> 冲刺，方向沿用预警时锁定的那个
  g.updateBoss(c.BOSS_DASH_WARN + 0.02);
  assert.ok(b.dashTime > 0, '应进入冲刺');
  assert.strictEqual(b.dir, warned, '冲刺方向应是预警时锁定的方向');
});

test('16.10 冲刺撞墙会提前结束冲刺，不会卡死', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;
  g.reset();
  // 贴着左墙、朝左冲刺
  const b = g.spawnBossAt(1, 8, 'dasher', 3, 1);
  b.dir = h.DIR.left;
  b.dashTime = c.BOSS_DASH_TIME;
  for (let i = 0; i < 10; i++) g.stepBoss(b);
  assert.strictEqual(b.dashTime, 0, '撞墙后应结束冲刺');
  for (const seg of b.snake) {
    assert.ok(seg.x >= 0 && seg.x < c.COLS, 'Boss 不得越界');
  }
});

test('16.11 多条 Boss 共存：各自独立移动、独立掉血', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.reset();
  const a = g.spawnBossAt(2, 2, 'chaser', 3, 2);
  const b = g.spawnBossAt(18, 18, 'chaser', 3, 2);
  assert.strictEqual(g.bosses.length, 2);
  const headA = H.cellOf(a.snake[0]);
  const headB = H.cellOf(b.snake[0]);
  g.updateBoss(0.5);
  assert.notDeepStrictEqual(H.cellOf(a.snake[0]), headA, 'A 应移动过');
  assert.notDeepStrictEqual(H.cellOf(b.snake[0]), headB, 'B 应移动过');

  g.damageBoss(a, a.snake[0].x, a.snake[0].y);
  assert.strictEqual(a.hp, 1);
  assert.strictEqual(b.hp, 2, '打 A 不该影响 B');
  assert.strictEqual(g.bosses.length, 2);
});

/* ================================================================== *
 * 3. 毒区地形
 * ================================================================== */
test('16.12 Boss 关生成毒区，非 Boss 关清空', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;

  g.reset();
  g.stage = 2;                 // 非 Boss 关
  g.advanceStage();            // 进入第 3 关（Boss 关）
  assert.strictEqual(g.stage, c.BOSS_FIRST_STAGE);
  assert.strictEqual(g.bosses.length, 1, 'Boss 关应生成 Boss');
  assert.strictEqual(g.hazards.length, c.HAZARD_COUNT, 'Boss 关应生成毒区');

  g.advanceStage();            // 进入第 4 关（非 Boss 关）
  assert.strictEqual(g.bosses.length, 0, '非 Boss 关应清掉 Boss');
  assert.strictEqual(g.hazards.length, 0, '非 Boss 关应清掉毒区');
});

test('16.13 毒区生成时不与蛇 / Boss / 食物重叠', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.reset();
  g.stage = h.Config.BOSS_FIRST_STAGE;
  g.spawnBoss();
  g.spawnHazards(h.Config.HAZARD_COUNT);
  for (const hz of g.hazards) {
    for (let a = hz.x; a < hz.x + hz.w; a++) {
      for (let b = hz.y; b < hz.y + hz.h; b++) {
        assert.ok(!g.snakeOccupies(a, b), `毒区压到了玩家蛇身 (${a},${b})`);
        assert.ok(!g.bossAt(a, b), `毒区压到了 Boss (${a},${b})`);
        assert.ok(!(g.food.x === a && g.food.y === b), '毒区压到了食物');
      }
    }
  }
});

test('16.14 踩进毒区受击（deathReason=hazard），免伤期间则停在原地', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.stageMode = false;
  placeSnake(h, 5, 5, 'right');
  g.hazards = [{ x: 6, y: 5, w: 1, h: 1, timer: 99 }];

  g.invincible = 0;
  assert.strictEqual(g.tick(), 'hit', '踩进毒区应受击');
  assert.strictEqual(g.deathReason, 'hazard');

  // 免伤期间再踩：blocked，不重复扣血
  const lives = g.lives;
  assert.strictEqual(g.tick(), 'blocked');
  assert.strictEqual(g.lives, lives, '免伤期间不应重复扣血');
});

test('16.15 毒区漂移永不压到玩家蛇身与食物', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;
  g.reset();
  g.spawnHazards(c.HAZARD_COUNT);
  assert.ok(g.hazards.length > 0);

  for (let i = 0; i < 40; i++) {
    g.updateHazards(c.HAZARD_DRIFT + 0.01);
    for (const hz of g.hazards) {
      assert.ok(hz.x >= 0 && hz.y >= 0 &&
                hz.x + hz.w <= c.COLS && hz.y + hz.h <= c.ROWS, '毒区漂移不得越界');
      for (let a = hz.x; a < hz.x + hz.w; a++) {
        for (let b = hz.y; b < hz.y + hz.h; b++) {
          assert.ok(!g.snakeOccupies(a, b), `漂移压到了玩家蛇身 (${a},${b})`);
          assert.ok(!(g.food.x === a && g.food.y === b), '漂移压到了食物');
        }
      }
    }
  }
});

/* ================================================================== *
 * 4. 渲染与端到端
 * ================================================================== */
test('16.16 渲染：三形态 + 毒区 + 血条 + 命中闪白全部不抛异常', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.reset();
  const kinds = ['chaser', 'splitter', 'dasher'];
  g.bosses = kinds.map((k, i) => g.spawnBossAt(2 + i * 6, 2, k, 4, 3)).filter(Boolean);
  assert.strictEqual(g.bosses.length, 3, '三种形态都应生成成功');
  g.bosses[0].hitFlash = h.Config.BOSS_HIT_FLASH;
  g.bosses[2].dashWarn = h.Config.BOSS_DASH_WARN;
  g.spawnHazards(h.Config.HAZARD_COUNT);
  assert.doesNotThrow(() => h.Renderer.render(0.5, 1.2));
  assert.doesNotThrow(() => h.Renderer.render(1, 3.4));
});

test('16.17 端到端：闯到 Boss 关会自动带上 Boss 与毒区', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const c = h.Config;

  g.stage = c.BOSS_FIRST_STAGE - 1;      // 停在 Boss 关的前一关
  g.stageFoods = g.stageTarget - 1;      // 再吃一颗过关
  assert.strictEqual(feedOnce(h), 'stageclear');
  assert.strictEqual(g.stage, c.BOSS_FIRST_STAGE);

  h.App.openUpgrade();
  h.UI.pickUpgrade(0);                   // 选完卡才继续

  assert.strictEqual(g.bosses.length, 1, '进入 Boss 关应生成 Boss');
  assert.strictEqual(g.hazards.length, c.HAZARD_COUNT, '进入 Boss 关应生成毒区');
  assert.strictEqual(g.bosses[0].kind, 'chaser');
  assert.doesNotThrow(() => h.pumpFrames(60));
});

test('16.18 端到端：连续撞尾打光 Boss 血量，走主循环不抛异常', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.reset();
  g.stage = h.Config.BOSS_FIRST_STAGE;
  const b = g.spawnBoss();
  assert.ok(b);

  // 反复把 Boss 尾节对准玩家蛇头正前方，模拟"追着尾巴打"
  // （Boss 每帧都在移动，所以用 tick 逐步驱动而不是 pumpFrames）
  const before = g.score;
  let guard = 0;
  while (g.bosses.length > 0 && guard++ < 20) {
    const head = g.snake[0];
    const d = g.dir;
    b.snake[b.snake.length - 1] = { x: head.x + d.x, y: head.y + d.y };
    b.prevSnake = b.snake.map((s) => ({ x: s.x, y: s.y }));
    const r = g.tick();
    assert.notStrictEqual(r, 'hit', `第 ${guard} 次撞尾不该受伤（实际 ${r}）`);
    if (g.state === h.STATE.GAMEOVER) break;
  }
  assert.strictEqual(g.bosses.length, 0, '应能把 Boss 打死');
  assert.strictEqual(g.score - before, h.Config.BOSS_KILL_SCORE, '击破应给满分');
  // 打完再跑一段真实主循环，确认后续帧不抛异常
  assert.doesNotThrow(() => h.pumpFrames(60));
  assert.deepStrictEqual(h.consoleLog, [], '运行期不应出现 console 输出');
});

test('16.19 重开一局：Boss 与毒区全部复位', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.reset();
  g.stage = h.Config.BOSS_FIRST_STAGE;
  g.spawnBoss();
  g.spawnHazards(h.Config.HAZARD_COUNT);
  assert.ok(g.bosses.length && g.hazards.length);

  h.App.restart();
  assert.strictEqual(g.bosses.length, 0, '重开应清空 Boss');
  assert.strictEqual(g.hazards.length, 0, '重开应清空毒区');
  assert.strictEqual(g.bossHitPlayer, false);
  assert.strictEqual(g._lastBossHit, null);
});
