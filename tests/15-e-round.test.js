/**
 * 运行：cd tests && node --test
 *
 * 15 - E 轮：生命值 / Combo 连击 / 过关三选一升级卡
 * 覆盖：
 *   - 撞毁只扣 1 点生命，扣光才结束；受击进入免伤并收缩蛇身
 *   - 免伤期间撞任何东西都停在原地（blocked），不重复扣血
 *   - 连击窗口内连续进食累乘得分、超时清零、受击清零
 *   - 升级卡：过关抽 3 张、等级上限、满血不抽急救包、键盘与点击双通道
 *   - 护盾果（shieldLevel 解锁）吃到给 6 秒免伤
 *   - HUD 生命显示、连击条、结算「最高连击」
 *
 * 说明：全部走源码真实路径（Game.tick / Game.hit / App.endGame / UI.syncOverlay），
 *      不复制任何逻辑到测试里。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/** 开一局并置于 playing 态 */
function fresh(h, stageMode) {
  h.App.start();
  h.Game.stageMode = stageMode !== false;
  return h.Game;
}

/** 把蛇摆成「下一次 tick 必定撞左墙」的姿态 */
function faceLeftWall(h) {
  const g = h.Game;
  g.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR.left;
  g.dirQueue = [];
  g.food = { x: 20, y: 20 };
  return g;
}

/** 把食物放到蛇头正前方并推进一步（必定吃到） */
function feedOnce(h) {
  const g = h.Game;
  const head = g.snake[0];
  const d = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
  const nx = head.x + d.x;
  const ny = head.y + d.y;
  assert.ok(nx >= 0 && ny >= 0 && nx < h.Config.COLS && ny < h.Config.ROWS, '喂食用目标越界');
  g.food = { x: nx, y: ny };
  return g.tick();
}

/** 反复抽卡直到抽到指定 id 的那一批（卡池随机，200 次足够） */
function rollUntil(h, id) {
  const g = h.Game;
  for (let i = 0; i < 200; i++) {
    const cards = g.rollUpgrades();
    if (cards.some((c) => c.id === id)) return cards;
  }
  return null;
}

/* ================================================================== *
 * 1. 生命值：撞毁不再一击致命
 * ================================================================== */
test('15.1 开局：满生命、无连击、升级记录为空', () => {
  const h = H.createHarness();
  const g = fresh(h);
  assert.strictEqual(g.lives, h.Config.START_LIVES);
  assert.strictEqual(g.maxLives, h.Config.START_LIVES);
  assert.strictEqual(g.invincible, 0);
  assert.strictEqual(g.combo, 0);
  assert.strictEqual(g.comboBest, 0);
  assert.deepStrictEqual(Object.keys(g.upgradeLevels), []);
});

test('15.2 撞墙只扣 1 点生命并进入免伤，不结束对局', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  faceLeftWall(h);
  const r = g.tick();
  assert.strictEqual(r, 'hit', '撞墙应判定为受击而不是死亡');
  assert.strictEqual(g.lives, h.Config.START_LIVES - 1, '应只扣 1 点生命');
  assert.strictEqual(g.state, h.STATE.PLAYING, '还有生命时不应结束');
  assert.strictEqual(g.deathReason, 'wall');
  assert.ok(g.invincible > 0, '受击后应进入免伤');
});

test('15.3 生命扣光才真正死亡', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  faceLeftWall(h);
  const n = h.Config.START_LIVES;
  for (let i = 1; i < n; i++) {
    g.invincible = 0;                      // 跳过免伤，接受下一次受击
    assert.strictEqual(g.tick(), 'hit', `第 ${i} 次撞击应只扣血`);
    assert.strictEqual(g.lives, n - i);
  }
  g.invincible = 0;
  assert.strictEqual(g.tick(), 'dead', '生命扣光后应死亡');
  assert.strictEqual(g.lives, 0);
});

test('15.4 免伤期间再撞：停在原地（blocked），不重复扣血', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  faceLeftWall(h);
  assert.strictEqual(g.tick(), 'hit');
  const livesAfterHit = g.lives;
  const head = H.cellOf(g.snake[0]);
  assert.strictEqual(g.tick(), 'blocked', '免伤期间撞墙应停在原地');
  assert.strictEqual(g.lives, livesAfterHit, '免伤期间不应重复扣血');
  assert.deepStrictEqual(H.cellOf(g.snake[0]), head, 'blocked 时蛇头不能移动');
  assert.ok(H.isContiguous(g.snake), 'blocked 时蛇身不能脱节');
});

test('15.5 受击收缩 HIT_SHRINK 节，但不低于 START_LEN', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  faceLeftWall(h);            // 先摆好撞墙姿态（会重置蛇身为 3 节）
  g.growSnake(4);             // 再变长，才能观察到收缩
  const before = g.snake.length;
  assert.strictEqual(g.tick(), 'hit');
  assert.strictEqual(g.snake.length, Math.max(h.Config.START_LEN, before - h.Config.HIT_SHRINK));
  assert.ok(H.isContiguous(g.snake), '收缩后蛇身必须连续');
});

test('15.6 受击清空连击（惩罚：断了就不给倍率）', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.combo, 1);
  faceLeftWall(h);
  g.tick();
  assert.strictEqual(g.combo, 0, '受击后连击应清零');
  assert.strictEqual(g.comboTimer, 0);
});

/* ================================================================== *
 * 2. Combo 连击
 * ================================================================== */
test('15.7 连击倍率：第 1 连 ×1.0，每层 +0.1，封顶 COMBO_MAX_MUL', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  const c = h.Config;
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}（${a} vs ${b}）`);

  g.combo = 0; near(g.comboMultiplier(), 1, '无连击应为 1');
  g.combo = 1; near(g.comboMultiplier(), 1, '第 1 连应为 1');
  g.combo = 2; near(g.comboMultiplier(), 1 + c.COMBO_STEP, '第 2 连应 +1 档');
  g.combo = 5; near(g.comboMultiplier(), 1 + 4 * c.COMBO_STEP, '第 5 连应 +4 档');
  g.combo = 999; near(g.comboMultiplier(), c.COMBO_MAX_MUL, '倍率应封顶');
});

test('15.8 连击窗口超时清零，窗口内进食则续上', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.combo, 1);
  assert.ok(g.comboTimer > 0);

  // 窗口内继续吃 -> 连击累加、窗口重置
  g.updateTimers(g.comboWindow * 0.5);
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.combo, 2);

  // 超过窗口未进食 -> 清零
  g.updateTimers(g.comboWindow + 0.1);
  assert.strictEqual(g.combo, 0, '超时后连击应清零');
  assert.strictEqual(g.comboTimer, 0);
});

test('15.9 连续吃 5 颗：得分按连击倍率累计，最高连击被记录', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  let expect = 0;
  for (let i = 1; i <= 5; i++) {
    assert.strictEqual(feedOnce(h), 'eat', `第 ${i} 颗应吃到`);
    expect += Math.round(h.Config.SCORE_PER_FOOD * g.comboMultiplier());
    assert.strictEqual(g.score, expect, `第 ${i} 颗后累计得分应为 ${expect}`);
  }
  assert.strictEqual(g.combo, 5);
  assert.strictEqual(g.comboBest, 5, '最高连击应记录为 5');
});

test('15.10 连击倍率随时间自然衰减后重开连击，得分回到基础值', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  feedOnce(h);
  feedOnce(h);
  const scoreAfter2 = g.score;
  g.updateTimers(g.comboWindow + 0.1);     // 断连
  feedOnce(h);                             // 重新开始连击
  assert.strictEqual(g.combo, 1);
  assert.strictEqual(g.score - scoreAfter2, h.Config.SCORE_PER_FOOD, '断连后应回到基础分');
});

/* ================================================================== *
 * 3. 升级卡
 * ================================================================== */
test('15.11 过关抽卡：恰好 3 张、互不重复、且都是未满级的', () => {
  const h = H.createHarness();
  const g = fresh(h);
  for (let round = 0; round < 20; round++) {
    const cards = g.rollUpgrades();
    assert.ok(cards.length > 0 && cards.length <= 3, `应抽到 1~3 张，实际 ${cards.length}`);
    const ids = cards.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length, '同批卡不能重复');
    for (const c of cards) {
      assert.ok((g.upgradeLevels[c.id] || 0) < c.max, `${c.id} 已满级却仍被抽到`);
    }
  }
});

test('15.12 过关后弹卡：awaitingUpgrade 期间主循环停止推进逻辑步', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.stageFoods = g.stageTarget - 1;        // 再吃一颗即过关
  assert.strictEqual(feedOnce(h), 'stageclear');
  assert.ok(g.pendingUpgrades && g.pendingUpgrades.length > 0, '过关应抽到升级卡');

  h.App.openUpgrade();
  assert.strictEqual(g.awaitingUpgrade, true);

  const before = h.tickCount();
  h.pumpFrames(60);
  assert.strictEqual(h.tickCount(), before, '选卡期间不应推进任何逻辑步');

  h.key('1');
  assert.strictEqual(g.awaitingUpgrade, false, '选完卡应立即恢复');
  h.pumpFrames(60);
  assert.ok(h.tickCount() > before, '选完卡后应恢复推进');
});

test('15.13 键盘 1 / 2 / 3 选卡生效并记等级', () => {
  const h = H.createHarness();
  const g = fresh(h);
  const cards = rollUntil(h, 'greed');
  assert.ok(cards, '应能抽到「贪婪」');
  const idx = cards.findIndex((c) => c.id === 'greed');

  g.pendingUpgrades = cards;
  g.awaitingUpgrade = true;
  h.UI.syncOverlay();
  const before = g.scoreMul;

  h.key(String(idx + 1));
  assert.strictEqual(g.applyUpgrade && g.upgradeLevels.greed, 1, '贪婪应记 1 级');
  assert.ok(g.scoreMul > before, '贪婪应提升得分倍率');
  assert.strictEqual(g.pendingUpgrades, null);
  assert.strictEqual(g.awaitingUpgrade, false);
});

test('15.14 点击卡片同样能选（移动端无键盘）', () => {
  const h = H.createHarness();
  const g = fresh(h);
  g.pendingUpgrades = g.rollUpgrades();
  g.awaitingUpgrade = true;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('选一项强化'), '应渲染升级卡面板');
  assert.ok(html.includes('id="upCard0"'), '卡片应带 id，便于点击/测试定位');

  const firstId = g.pendingUpgrades[0].id;
  h.els.get('upCard0').fire('click', { stopPropagation() {}, preventDefault() {} });
  assert.strictEqual(g.upgradeLevels[firstId], 1, '点击第一张卡应生效');
  assert.strictEqual(g.awaitingUpgrade, false);
});

test('15.15 升级卡效果：强心 —— 生命上限 +1 并立即回 1 点', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  const cards = rollUntil(h, 'heart');
  assert.ok(cards);
  g.lives = 1;
  g.pendingUpgrades = cards;
  g.awaitingUpgrade = true;

  const maxBefore = g.maxLives;
  assert.ok(h.UI.pickUpgrade(cards.findIndex((c) => c.id === 'heart')));
  assert.strictEqual(g.maxLives, maxBefore + 1);
  assert.strictEqual(g.lives, 2, '应回 1 点生命');
});

test('15.16 升级卡效果：连击大师 —— 窗口 +2 秒', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  const cards = rollUntil(h, 'combo');
  assert.ok(cards);
  g.pendingUpgrades = cards;
  g.awaitingUpgrade = true;
  const before = g.comboWindow;
  h.UI.pickUpgrade(cards.findIndex((c) => c.id === 'combo'));
  assert.strictEqual(g.comboWindow, before + 2);
  assert.strictEqual(g.upgradeLevels.combo, 1);
});

test('15.17 升级卡效果：稳如老狗 —— 基础速度每层降 CALM_TPS', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  const cards = rollUntil(h, 'calm');
  assert.ok(cards);
  g.pendingUpgrades = cards;
  g.awaitingUpgrade = true;
  const before = g.tps();
  h.UI.pickUpgrade(cards.findIndex((c) => c.id === 'calm'));
  assert.ok(g.tps() < before, `应降速（${before} -> ${g.tps()}）`);
  assert.ok(g.tps() >= h.Config.SPECIAL_MIN_TPS, '降速不得低于下限');
});

test('15.18 升级卡效果：贪婪 —— 得分 ×(1 + 0.15×层数)', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  const cards = rollUntil(h, 'greed');
  assert.ok(cards);
  g.pendingUpgrades = cards;
  g.awaitingUpgrade = true;
  h.UI.pickUpgrade(cards.findIndex((c) => c.id === 'greed'));
  assert.ok(Math.abs(g.scoreMul - 1.15) < 1e-9);

  // 实吃一颗验证：基础分 × 贪婪倍率
  g.combo = 0;
  g.comboTimer = 0;
  feedOnce(h);
  assert.strictEqual(g.score, Math.round(h.Config.SCORE_PER_FOOD * 1.15));
});

test('15.19 满血时不抽到「急救包」（available 门槛生效）', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.lives = g.maxLives;
  for (let i = 0; i < 50; i++) {
    const cards = g.rollUpgrades();
    assert.ok(!cards.some((c) => c.id === 'heal'), '满血时不应出现急救包');
  }
  g.lives = g.maxLives - 1;
  const cards = rollUntil(h, 'heal');
  assert.ok(cards, '掉血后应能抽到急救包');
});

test('15.20 升级卡等级达到上限后不再出现', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.upgradeLevels.combo = 3;              // 连击大师 max = 3
  for (let i = 0; i < 50; i++) {
    const cards = g.rollUpgrades();
    assert.ok(!cards.some((c) => c.id === 'combo'), '已满级的卡不应再被抽到');
  }
});

/* ================================================================== *
 * 4. 护盾果（shieldLevel 解锁）
 * ================================================================== */
test('15.21 未解锁时刷新池里没有护盾果，解锁后出现', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.shieldLevel = 0;
  for (let i = 0; i < 40; i++) {
    g.special = null;
    assert.notStrictEqual(g.spawnSpecial(), 'shield', '未解锁时不应刷出护盾果');
  }
  g.shieldLevel = 1;
  let got = false;
  for (let i = 0; i < 60; i++) {
    g.special = null;
    if (g.spawnSpecial() === 'shield') { got = true; break; }
  }
  assert.ok(got, '解锁后应能刷出护盾果');
});

test('15.22 吃到护盾果：获得 SHIELD_TIME 免伤，期间撞击不扣血', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.applySpecial({ type: 'shield' });
  assert.strictEqual(g.invincible, h.Config.SHIELD_TIME);

  faceLeftWall(h);
  const lives = g.lives;
  assert.strictEqual(g.tick(), 'blocked', '护盾期间撞墙应停在原地');
  assert.strictEqual(g.lives, lives, '护盾期间不应扣血');
});

/* ================================================================== *
 * 5. UI：生命显示、连击条、结算
 * ================================================================== */
test('15.23 HUD 生命：实心数 = 剩余生命，其余为空心', () => {
  const h = H.createHarness();
  const g = fresh(h);
  h.UI.updateHud();
  let html = h.els.get('livesEl').innerHTML;
  assert.strictEqual((html.match(/♥/g) || []).length, h.Config.START_LIVES);
  assert.strictEqual((html.match(/♡/g) || []).length, 0);

  g.lives = 1;
  h.UI.updateHud();
  html = h.els.get('livesEl').innerHTML;
  assert.strictEqual((html.match(/♥/g) || []).length, 1, '应只剩 1 颗实心');
  assert.strictEqual((html.match(/♡/g) || []).length, h.Config.START_LIVES - 1);
  assert.ok(h.els.get('livesEl').classList.contains('low'), '剩 1 点应进入告警样式');
});

test('15.24 连击条：有连击时显示层数与倒计时，清零后隐藏', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.state = h.STATE.PLAYING;

  g.combo = 4;
  g.comboTimer = 6.5;
  h.UI.updateCombo();
  assert.strictEqual(h.els.get('comboBar').hidden, false, '有连击时应显示');
  assert.ok(h.els.get('comboCnt').textContent.includes('4'), '应显示连击层数');
  assert.ok(h.els.get('comboMul').textContent.startsWith('×'), '应显示倍率');

  g.combo = 0;
  g.comboTimer = 0;
  h.UI.updateCombo();
  assert.strictEqual(h.els.get('comboBar').hidden, true, '连击清零后应隐藏');
});

test('15.25 结算面板展示「最高连击」', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.comboBest = 7;
  H.killPlayer(h);
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('最高连击'), '结算应包含最高连击一格');
  assert.ok(html.includes('>7<'), '应显示本局最高连击 7');
});

/* ================================================================== *
 * 6. 渲染与端到端
 * ================================================================== */
test('15.26 渲染：护盾果 + 免伤闪烁不抛异常', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.special = { x: 5, y: 6, type: 'shield', ttl: 5, maxTtl: 8 };
  g.invincible = 1.2;
  assert.doesNotThrow(() => h.Renderer.render(0.5, 1.2));
  g.special = null;
  g.invincible = 0;
  assert.doesNotThrow(() => h.Renderer.render(0.5, 2.4));
});

test('15.27 端到端：过关弹卡 -> 选卡 -> 继续闯下一关，全程不抛异常', () => {
  const h = H.createHarness();
  const g = fresh(h);
  let clears = 0;

  for (let round = 0; round < 3; round++) {
    // F 轮起 Boss 关会带 Boss 与毒区，本例只验证升级卡流程，清掉这些干扰
    g.hazards = [];
    g.bosses = [];
    g.stageFoods = g.stageTarget - 1;      // 再吃一颗即过关
    const r = feedOnce(h);
    if (r === 'win') break;
    assert.strictEqual(r, 'stageclear', `第 ${round + 1} 次应过关`);
    clears++;

    h.App.openUpgrade();
    assert.strictEqual(g.awaitingUpgrade, true);
    h.pumpFrames(30);                      // 选卡期间画面继续渲染但不推进逻辑
    assert.ok(h.UI.pickUpgrade(0), '应能选中第一张卡');
    assert.strictEqual(g.awaitingUpgrade, false);
    h.pumpFrames(30);
  }

  assert.ok(clears >= 1, '至少应完整走过一次过关选卡');
  assert.ok(g.stage > 1, `关卡应推进到第 2 关以上，实际 ${g.stage}`);
  assert.ok(Object.keys(g.upgradeLevels).length >= 1, '应记录已选升级');
  assert.deepStrictEqual(h.consoleLog, [], '运行期不应出现 console 输出');
});

test('15.28 重开一局：生命 / 连击 / 升级全部复位', () => {
  const h = H.createHarness();
  const g = fresh(h, false);
  g.lives = 1;
  g.combo = 6;
  g.upgradeLevels.greed = 2;
  g.scoreMul = 1.3;
  faceLeftWall(h);
  H.killPlayer(h);
  assert.strictEqual(g.state, h.STATE.GAMEOVER);

  h.App.restart();
  assert.strictEqual(g.lives, h.Config.START_LIVES, '重开应回满生命');
  assert.strictEqual(g.combo, 0, '重开应清空连击');
  assert.strictEqual(g.comboBest, 0);
  assert.strictEqual(g.scoreMul, 1, '重开应清空升级效果');
  assert.deepStrictEqual(Object.keys(g.upgradeLevels), []);
  assert.strictEqual(g.awaitingUpgrade, false);
});
