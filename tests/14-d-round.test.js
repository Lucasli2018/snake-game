'use strict';
/**
 * 14-D 轮：关卡递进 + 障碍物 + Boss 蛇（P1 体验增强）
 * 覆盖：闯关开关、关卡推进与通关、障碍物合法性、撞障碍/撞 Boss 死亡、
 *      Boss 生成与追击、关卡横幅、渲染与 HUD、主循环集成、结束文案。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('14.1 闯关开关：默认关闭，App.start 开启，reset 不清除该开关', () => {
  const h = H.createHarness();
  const g = h.Game;
  assert.strictEqual(g.stageMode, false, '默认应关闭闯关模式');

  h.startPlaying();                         // 走真实启动 -> 应开启
  assert.strictEqual(g.stageMode, true, 'App.start 后闯关模式应开启');
  assert.strictEqual(g.stage, 1, '应从第 1 关开始');

  // reset 不应把外部设置的开关清掉
  g.reset();
  assert.strictEqual(g.stageMode, true, 'reset 不应清除闯关开关');
  assert.strictEqual(g.obstacles.length, 0, '第 1 关无障碍物');
});

test('14.2 关卡递进：吃满目标食物触发 stageclear，关卡+1、目标变大、障碍增加', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;

  let last = 'move';
  for (let i = 0; i < c.STAGE_BASE_TARGET; i++) {
    const head = g.snake[0], d = g.dir;
    g.food = { x: head.x + d.x, y: head.y + d.y };   // 第 1 关无障碍，下一格必为空
    last = g.tick();
  }
  assert.strictEqual(g.stage, 2, '吃满第 1 关目标后进入第 2 关');
  assert.strictEqual(last, 'stageclear', '过关那一 tick 应返回 stageclear');
  assert.strictEqual(g.stageTarget, c.STAGE_BASE_TARGET + c.STAGE_TARGET_STEP,
    '第 2 关目标食物应变大');
  assert.strictEqual(g.obstacles.length, c.OBSTACLE_STEP, '过关应新增障碍');
});

test('14.3 通关：吃满最后一关目标食物 -> win，Game.win=true', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  g.stage = c.TOTAL_STAGES;
  g.stageTarget = c.STAGE_BASE_TARGET + (c.TOTAL_STAGES - 1) * c.STAGE_TARGET_STEP;
  g.stageFoods = g.stageTarget - 1;
  g.obstacles = [];
  g.boss = null;
  const head = g.snake[0], d = g.dir;
  g.food = { x: head.x + d.x, y: head.y + d.y };
  const r = g.tick();
  assert.strictEqual(r, 'win', '吃满最后一关应通关');
  assert.strictEqual(g.win, true);
});

test('14.4 障碍物合法：不在棋盘外、不压蛇身/食物，且 placeFood 永不与之重叠', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  g.advanceStage();           // 进第 2 关，加一批障碍
  g.advanceStage();           // 进第 3 关，再加一批
  assert.ok(g.obstacles.length > 0);
  for (const o of g.obstacles) {
    assert.ok(o.x >= 0 && o.x < c.COLS && o.y >= 0 && o.y < c.ROWS, '障碍必须在棋盘内');
    assert.ok(!g.snakeOccupies(o.x, o.y), '障碍不得压在蛇身上');
    assert.ok(!(g.food.x === o.x && g.food.y === o.y), '障碍不得压在食物上');
  }
  // 反复生成食物，确认永不落在障碍上
  for (let i = 0; i < 200; i++) {
    g.placeFood();
    assert.ok(!(g.food.x >= 0 && g.isObstacle(g.food.x, g.food.y)), 'food 不得与障碍重叠');
  }
});

test('14.5 撞障碍物 -> dead，deathReason=obstacle', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  const head = g.snake[0], d = g.dir;
  const nx = head.x + d.x, ny = head.y + d.y;
  g.obstacles = [{ x: nx, y: ny }];
  g.food = { x: 0, y: 0 };    // 远离，避免 willGrow 干扰
  const r = g.tick();
  assert.strictEqual(r, 'dead');
  assert.strictEqual(g.deathReason, 'obstacle');
});

test('14.6 撞 Boss 蛇身 -> dead，deathReason=boss', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  const head = g.snake[0], d = g.dir;
  const nx = head.x + d.x, ny = head.y + d.y;
  // 手工放置一条 Boss 蛇，头正好挡在玩家下一格
  g.boss = {
    snake: [{ x: nx, y: ny }, { x: nx - 1, y: ny }, { x: nx - 2, y: ny }],
    prevSnake: [{ x: nx, y: ny }, { x: nx - 1, y: ny }, { x: nx - 2, y: ny }],
    dir: h.DIR.right, acc: 0
  };
  g.food = { x: 0, y: 0 };
  const r = g.tick();
  assert.strictEqual(r, 'dead');
  assert.strictEqual(g.deathReason, 'boss');
});

test('14.7 Boss 关判定与生成：第 3/6 关有 Boss，非 Boss 关无；Boss 蛇身合法', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  assert.strictEqual(g.isBossStage(1), false);
  assert.strictEqual(g.isBossStage(2), false);
  assert.strictEqual(g.isBossStage(3), true, '第 3 关应为 Boss 关');
  assert.strictEqual(g.isBossStage(4), false);
  assert.strictEqual(g.isBossStage(5), false);
  assert.strictEqual(g.isBossStage(6), true, '第 6 关应为 Boss 关');

  g.stageMode = true;
  g.reset();
  g.spawnBoss();
  assert.ok(g.boss, '应成功生成 Boss 蛇');
  assert.strictEqual(g.boss.snake.length, c.BOSS_LEN, 'Boss 蛇长度应等于 BOSS_LEN');
  for (const s of g.boss.snake) {
    assert.ok(s.x >= 0 && s.x < c.COLS && s.y >= 0 && s.y < c.ROWS, 'Boss 节必须在棋盘内');
    assert.ok(!g.snakeOccupies(s.x, s.y), 'Boss 不得压在玩家蛇身上');
    assert.ok(!g.isObstacle(s.x, s.y), 'Boss 不得压在障碍上');
  }
});

test('14.8 Boss 追击：朝食物移动，若干步后离食物更近且不越界', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.stageMode = true;
  g.reset();
  g.spawnBoss();
  g.food = { x: c.COLS - 2, y: c.ROWS - 2 };   // 把食物放到对角，逼 Boss 追过去
  const head0 = g.boss.snake[0];
  const dist0 = Math.abs(head0.x - g.food.x) + Math.abs(head0.y - g.food.y);
  g.updateBoss(2.0);                            // 2 秒 -> 约 8 步
  const head1 = g.boss.snake[0];
  const dist1 = Math.abs(head1.x - g.food.x) + Math.abs(head1.y - g.food.y);
  assert.ok(head0.x !== head1.x || head0.y !== head1.y, 'Boss 应当移动过');
  assert.ok(dist1 <= dist0, 'Boss 应朝食物靠近（距离不增）');
  assert.ok(head1.x >= 0 && head1.x < c.COLS && head1.y >= 0 && head1.y < c.ROWS,
    'Boss 不得越界');
});

test('14.9 Boss 撞玩家 -> bossHitPlayer=true', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  const head = g.snake[0];
  // Boss 头贴在玩家左侧、朝右（食物也放在右侧，诱导它向右追），下一步即撞上玩家头
  g.food = { x: head.x + 5, y: head.y };
  g.boss = {
    snake: [{ x: head.x - 1, y: head.y }, { x: head.x - 2, y: head.y }, { x: head.x - 3, y: head.y }],
    prevSnake: [{ x: head.x - 1, y: head.y }, { x: head.x - 2, y: head.y }, { x: head.x - 3, y: head.y }],
    dir: h.DIR.right, acc: 0
  };
  g.bossHitPlayer = false;
  g.stepBoss();
  assert.strictEqual(g.bossHitPlayer, true, 'Boss 撞到玩家应置位 bossHitPlayer');
});

test('14.10 关卡横幅：advanceStage 设置横幅文案与计时，updateTimers 递减', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  g.advanceStage();
  assert.strictEqual(g.stageBannerText, '第 2 关', '横幅文案应为「第 2 关」');
  assert.ok(g.stageBannerTime > 0, '横幅计时应 > 0');
  const t0 = g.stageBannerTime;
  g.updateTimers(0.5);
  assert.ok(g.stageBannerTime < t0, 'updateTimers 应递减横幅计时');
});

test('14.11 渲染含障碍/Boss/横幅不抛异常', () => {
  const h = H.createHarness();
  h.startPlaying();
  const g = h.Game;
  g.advanceStage();           // 障碍
  g.spawnBoss();               // Boss
  g.stageBannerText = '第 3 关';
  g.stageBannerTime = 1.5;
  assert.doesNotThrow(() => h.Renderer.render(0.5), '含障碍/Boss/横幅渲染不应抛异常');
  // Boss 撞玩家后的定格帧也应能渲染
  g.bossHitPlayer = true;
  assert.doesNotThrow(() => h.Renderer.render(0.5));
});

test('14.12 HUD 同步关卡与食物进度', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.stageMode = true;
  g.reset();
  g.state = h.STATE.PLAYING;
  h.UI.updateHud();
  assert.ok(h.els.get('stageEl').textContent.includes('第 1 关'), '关卡应显示第 1 关');
  assert.ok(h.els.get('stageProgEl').textContent.includes('0/' + h.Config.STAGE_BASE_TARGET),
    '进度应显示 0/目标');

  // 吃一颗 -> 进度 +1
  const head = g.snake[0], d = g.dir;
  g.food = { x: head.x + d.x, y: head.y + d.y };
  g.tick();
  h.UI.updateHud();
  assert.ok(h.els.get('stageProgEl').textContent.includes('1/' + h.Config.STAGE_BASE_TARGET),
    '吃到一颗后进度应为 1/目标');
});

test('14.13 主循环真实闯关：长时间运行不抛异常、状态自洽', () => {
  const h = H.createHarness();
  h.startPlaying();              // 闯关模式 + 真实主循环
  for (let i = 0; i < 6000; i++) {
    if (h.Game.state === h.STATE.GAMEOVER) h.key('r');     // 死了就重开继续闯
    if (i % 5 === 0) h.key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][(Math.random() * 4) | 0]);
    h.pump();
    assert.ok(h.App.alpha >= 0 && h.App.alpha <= 1, `第 ${i} 帧 alpha 越界`);
  }
  assert.deepStrictEqual(h.consoleLog, [], '运行期出现了 console 输出');
  assert.ok(h.Game.stage >= 1, '关卡计数应 >= 1');
});

test('14.14 GameOver 文案：障碍/Boss 死因与通关文案正确', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.stageMode = true;
  g.reset();

  g.deathReason = 'obstacle';
  g.state = h.STATE.GAMEOVER;
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('障碍物'), '障碍死因文案应包含「障碍物」');

  g.deathReason = 'boss';
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('Boss'), 'Boss 死因文案应包含「Boss」');

  g.win = true;
  g.deathReason = '';
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('通关'), '通关文案应包含「通关」');
});
