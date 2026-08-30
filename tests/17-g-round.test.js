/**
 * 运行：cd tests && node --test
 *
 * 17 - G 轮：模式 / 成就 / 皮肤 / 统计
 * 覆盖：
 *   - 模式：闯关（不变长）/ 无尽（吃食物变长 + 定期弹升级卡）/ 限时（倒计时与结算）
 *   - 成就：解锁条件、不重复解锁、提示卡、持久化
 *   - 皮肤：默认可用、未解锁不可选、解锁后切换并持久化
 *   - 统计：一局结束累加、最高连击取最大、持久化
 *   - 开始屏渲染模式 / 皮肤 / 档案，按钮点击生效
 *
 * 说明：全部走源码真实路径，不复制逻辑到测试里。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const CLICK = { stopPropagation() {}, preventDefault() {} };

/** 把食物放到蛇头正前方并推进一步（必定吃到） */
function feedOnce(h) {
  const g = h.Game;
  const head = g.snake[0];
  const d = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
  const nx = head.x + d.x, ny = head.y + d.y;
  assert.ok(nx >= 0 && ny >= 0 && nx < h.Config.COLS && ny < h.Config.ROWS, '喂食目标越界');
  g.food = { x: nx, y: ny };
  return g.tick();
}

/* ================================================================== *
 * 1. 模式
 * ================================================================== */
test('17.1 默认模式是闯关，setMode 可切换', () => {
  const h = H.createHarness();
  const g = h.Game;
  assert.strictEqual(g.mode, 'stage', '默认应为闯关');
  assert.strictEqual(g.setMode('endless'), 'endless');
  assert.strictEqual(g.mode, 'endless');
  assert.strictEqual(g.setMode('timeattack'), 'timeattack');
  assert.strictEqual(g.isTimeAttack(), true);
  assert.strictEqual(g.setMode('stage'), 'stage');
  assert.strictEqual(g.isTimeAttack(), false);
  assert.strictEqual(g.setMode('nonsense'), 'stage', '非法模式应兜底为闯关');
});

test('17.2 闯关模式：吃食物不变长（回归 E 轮规则）', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('stage');
  h.App.start();
  assert.strictEqual(g.stageMode, true);
  const len0 = g.snake.length;
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.snake.length, len0, '闯关模式吃食物不应变长');
  assert.strictEqual(g.shouldGrow(), false);
});

test('17.3 无尽模式：吃食物变长，且不走关卡 / Boss / 毒区', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('endless');
  h.App.start();
  assert.strictEqual(g.stageMode, false, '无尽模式不应走闯关逻辑');

  const len0 = g.snake.length;
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.snake.length, len0 + 1, '无尽模式吃食物应增长 1 节');
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.snake.length, len0 + 2);
  assert.strictEqual(g.shouldGrow(), true);
  assert.strictEqual(g.bosses.length, 0);
  assert.strictEqual(g.hazards.length, 0);
});

test('17.4 无尽模式：每升 UPGRADE_EVERY_LEVEL 级弹一次升级卡', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.setMode('endless');
  h.App.start();
  g.pendingUpgrades = null;

  // 差一颗就跨过 3 级线（每级 100 分）
  g.score = c.SCORE_PER_LEVEL * c.UPGRADE_EVERY_LEVEL - c.SCORE_PER_FOOD;
  assert.strictEqual(g.level, 0);
  assert.strictEqual(feedOnce(h), 'eat');
  assert.strictEqual(g.level, c.UPGRADE_EVERY_LEVEL, '等级应随分数提升');
  assert.ok(g.pendingUpgrades && g.pendingUpgrades.length > 0, '应弹出升级卡');
});

test('17.5 限时模式：倒计时归零后置 timeUp，主循环结算而非死亡', () => {
  const h = H.createHarness();
  const g = h.Game;
  const c = h.Config;
  g.setMode('timeattack');
  h.App.start();

  assert.strictEqual(g.timeLeft, c.TIME_ATTACK_SEC);
  g.updateTimers(1.0);
  assert.ok(Math.abs(g.timeLeft - (c.TIME_ATTACK_SEC - 1)) < 1e-9, '倒计时应按真实时间递减');
  assert.strictEqual(g.timeUp, false);

  g.updateTimers(c.TIME_ATTACK_SEC);
  assert.strictEqual(g.timeLeft, 0);
  assert.strictEqual(g.timeUp, true);

  h.pump();                                   // 主循环消费 timeUp
  assert.strictEqual(g.state, h.STATE.GAMEOVER);
  assert.strictEqual(g.deathReason, 'timeup', '限时应标记为时间到，而不是撞死');
  assert.ok(h.els.get('panel').innerHTML.includes('时间到'), '结束文案应提示时间到');
});

test('17.6 非限时模式不会触发倒计时', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('endless');
  h.App.start();
  assert.strictEqual(g.timeLeft, 0);
  g.updateTimers(999);
  assert.strictEqual(g.timeUp, false);
  assert.strictEqual(g.timeLeft, 0);
});

test('17.7 HUD：限时模式显示剩余时间，闯关模式显示关卡', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('timeattack');
  h.App.start();
  g.updateTimers(2.5);
  h.UI.updateHud();
  assert.ok(h.els.get('stageEl').textContent.includes('剩余'), '限时模式应显示剩余时间');
  assert.strictEqual(h.els.get('stageProgEl').textContent, '限时冲刺');

  g.setMode('stage');
  h.App.start();
  h.UI.updateHud();
  assert.ok(h.els.get('stageEl').textContent.includes('第 1 关'));
});

/* ================================================================== *
 * 2. 成就
 * ================================================================== */
test('17.8 成就按条件解锁，且不重复解锁', () => {
  const h = H.createHarness();
  const g = h.Game;
  h.Achievements.load();
  assert.strictEqual(h.Achievements.count(), 0);

  g.score = 100;
  const got = g.checkAchievements();
  assert.ok(got.indexOf('score100') >= 0, '百分达人应解锁');
  assert.strictEqual(h.Achievements.has('score100'), true);
  assert.strictEqual(h.Achievements.count(), 1);

  const again = g.checkAchievements();
  assert.strictEqual(again.indexOf('score100'), -1, '已解锁的不应重复触发');
  assert.strictEqual(h.Achievements.count(), 1);
});

test('17.9 成就解锁会弹出提示卡，并随时��递减消失', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.score = 500;
  g.checkAchievements();
  assert.ok(g.achToast, '应生成成就提示');
  assert.strictEqual(g.achToast.name, '五百俱乐部');
  assert.strictEqual(g.achToast.time, h.Config.ACH_TOAST_TIME);

  g.updateTimers(h.Config.ACH_TOAST_TIME + 0.1);
  assert.strictEqual(g.achToast, null, '超时后提示应消失');
});

test('17.10 各类成就的触发条件', () => {
  const h = H.createHarness();
  const g = h.Game;

  g.comboBest = 15;
  g.checkAchievements();
  assert.strictEqual(h.Achievements.has('combo5'), true);
  assert.strictEqual(h.Achievements.has('combo15'), true);

  g.runBossKills = 1;
  g._killedSplitter = true;
  g.checkAchievements();
  assert.strictEqual(h.Achievements.has('boss1'), true);
  assert.strictEqual(h.Achievements.has('bossSplit'), true);

  g._gotBonus = true;
  g.checkAchievements();
  assert.strictEqual(h.Achievements.has('lucky'), true);

  g.growSnake(20);
  assert.ok(g.snake.length >= 20);
  g.checkAchievements();
  assert.strictEqual(h.Achievements.has('long'), true);

  g.score = 1000;
  g.checkAchievements();
  assert.strictEqual(h.Achievements.has('score1000'), true);
});

test('17.11 成就持久化到 localStorage，且能重新读出', () => {
  const h = H.createHarness();
  h.Game.score = 100;
  h.Game.checkAchievements();
  const raw = h.storageMap().get(h.Config.STORAGE_ACH);
  assert.ok(raw, '应写入 localStorage');
  assert.ok(raw.includes('score100'), '写入内容应包含成就 id');

  // 用一个干净的实例再读一次（模拟刷新页面）
  h.Achievements.unlocked = {};
  h.Achievements.load();
  assert.strictEqual(h.Achievements.has('score100'), true, '重新载入后仍应保留');
});

test('17.12 成就数据损坏时降级为空进度，不抛异常', () => {
  const h = H.createHarness();
  h.storageMap().set(h.Config.STORAGE_ACH, '{ this is not json');
  assert.doesNotThrow(() => h.Achievements.load());
  assert.strictEqual(h.Achievements.count(), 0);

  h.storageMap().set(h.Config.STORAGE_ACH, '[1,2,3]');   // 数组也是脏数据
  assert.doesNotThrow(() => h.Achievements.load());
  assert.strictEqual(h.Achievements.count(), 0);
});

/* ================================================================== *
 * 3. 皮肤
 * ================================================================== */
test('17.13 默认皮肤可直接使用，未解锁的不可选', () => {
  const h = H.createHarness();
  h.Achievements.load();
  h.Skins.load();
  assert.strictEqual(h.Skins.current, 'classic');
  assert.strictEqual(h.Skins.isUnlocked('classic'), true);
  assert.strictEqual(h.Skins.isUnlocked('gold'), false, '未拿到成就时鎏金应锁定');

  assert.strictEqual(h.Skins.select('gold'), false, '锁定的皮肤不应可切换');
  assert.strictEqual(h.Skins.current, 'classic', '切换失败应保持原样');
  assert.strictEqual(h.Skins.select('notExist'), false);
});

test('17.14 拿到成就后可切换皮肤，并持久化', () => {
  const h = H.createHarness();
  h.Achievements.load();
  h.Skins.load();
  h.Achievements.unlock('score500');

  assert.strictEqual(h.Skins.isUnlocked('gold'), true);
  assert.strictEqual(h.Skins.select('gold'), true);
  assert.strictEqual(h.Skins.current, 'gold');
  assert.strictEqual(h.storageMap().get(h.Config.STORAGE_SKIN), 'gold');

  const skin = h.Skins.currentSkin();
  assert.strictEqual(skin.id, 'gold');
  assert.ok(skin.c1 && skin.c2 && skin.c3 && skin.edge, '皮肤应带完整配色');
});

test('17.15 皮肤存储被污染时回落默认皮肤', () => {
  const h = H.createHarness();
  h.storageMap().set(h.Config.STORAGE_SKIN, 'hack-skin');
  h.Skins.load();
  assert.strictEqual(h.Skins.current, 'classic');
  assert.strictEqual(h.Skins.currentSkin().id, 'classic');
});

test('17.16 每款皮肤的解锁条件都能在成就表��找到', () => {
  const h = H.createHarness();
  for (const sk of h.SNAKE_SKINS) {
    if (!sk.unlock) continue;
    assert.ok(h.Achievements.find(sk.unlock), `皮肤「${sk.name}」的解锁成就 ${sk.unlock} 不存在`);
  }
});

/* ================================================================== *
 * 4. 统计
 * ================================================================== */
test('17.17 一局结束累加统计：局数、得分、食物、时长、连击', () => {
  const h = H.createHarness();
  const g = h.Game;
  h.Stats.load();
  const before = Object.assign({}, h.Stats.data);
  assert.strictEqual(before.games, 0);

  h.App.start();
  g.score = 120;
  g.runFoods = 5;
  g.comboBest = 6;
  g.runBossKills = 2;
  H.killPlayer(h);

  assert.strictEqual(h.Stats.data.games, before.games + 1);
  assert.strictEqual(h.Stats.data.totalScore, 120);
  assert.strictEqual(h.Stats.data.totalFoods, 5);
  assert.strictEqual(h.Stats.data.bestCombo, 6);
  assert.strictEqual(h.Stats.data.bossKills, 2);
  // 时长由 App 按真实时间写入（测试是瞬时执行，通常就是 0），只校验类型与非负
  assert.ok(typeof h.Stats.data.totalDuration === 'number' && h.Stats.data.totalDuration >= 0);
});

test('17.18 最高连击只取历史最大值', () => {
  const h = H.createHarness();
  h.Stats.load();
  h.Stats.merge({ bestCombo: 9, score: 0, foods: 0, duration: 0, bossKills: 0, win: false });
  assert.strictEqual(h.Stats.data.bestCombo, 9);
  h.Stats.merge({ bestCombo: 3, score: 0, foods: 0, duration: 0, bossKills: 0, win: false });
  assert.strictEqual(h.Stats.data.bestCombo, 9, '更低的连击不应覆盖历史最高');
});

test('17.19 通关计入 wins，并持久化', () => {
  const h = H.createHarness();
  h.Stats.load();
  assert.strictEqual(h.Stats.data.wins, 0);
  h.Stats.merge({ win: true, score: 500, foods: 10, duration: 60, bestCombo: 4, bossKills: 1 });

  const raw = h.storageMap().get(h.Config.STORAGE_STATS);
  assert.ok(raw, '统计应写入 localStorage');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.wins, 1);
  assert.strictEqual(parsed.totalScore, 500);
});

test('17.20 统计脏数据回落默认值', () => {
  const h = H.createHarness();
  h.storageMap().set(h.Config.STORAGE_STATS, 'not-json');
  assert.doesNotThrow(() => h.Stats.load());
  assert.strictEqual(h.Stats.data.games, 0);

  h.storageMap().set(h.Config.STORAGE_STATS, JSON.stringify({ games: -5, totalScore: 'x' }));
  h.Stats.load();
  assert.strictEqual(h.Stats.data.games, 0, '负数应被丢弃');
  assert.strictEqual(h.Stats.data.totalScore, 0, '非数字应被丢弃');
});

/* ================================================================== *
 * 5. 开始屏 UI
 * ================================================================== */
test('17.21 开始屏渲染模式选择 / 皮肤选择 / 档案条', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;

  for (let i = 0; i < h.MODES.length; i++) {
    assert.ok(html.includes('id="mode' + i + '"'), `应渲染模式按钮 mode${i}`);
  }
  for (let i = 0; i < h.SNAKE_SKINS.length; i++) {
    assert.ok(html.includes('id="skin' + i + '"'), `应渲染皮肤按钮 skin${i}`);
  }
  assert.ok(html.includes('class="profile"'), '应渲染档案条');
  assert.ok(html.includes('成就'), '档案条应含成就进度');
  assert.ok(html.includes('class="skin-dot locked"'), '未解锁皮肤应带 locked 样式');
});

test('17.22 点击模式按钮切换模式并即时重绘面板', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.state = h.STATE.READY;
  h.UI.syncOverlay();

  h.els.get('mode1').fire('click', CLICK);
  assert.strictEqual(g.mode, 'endless');

  h.els.get('mode2').fire('click', CLICK);
  assert.strictEqual(g.mode, 'timeattack');
  assert.ok(h.els.get('panel').innerHTML.includes('id="mode2"'), '面板应已重绘');
});

test('17.23 点击锁定的皮肤无效，解锁后生效', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.state = h.STATE.READY;
  h.UI.syncOverlay();

  h.els.get('skin1').fire('click', CLICK);     // 鎏金：需 score500
  assert.strictEqual(h.Skins.current, 'classic', '锁定皮肤点击无效');

  h.Achievements.unlock('score500');
  h.UI.syncOverlay();
  h.els.get('skin1').fire('click', CLICK);
  assert.strictEqual(h.Skins.current, 'gold');
});

/* ================================================================== *
 * 6. 渲染与端到端
 * ================================================================== */
test('17.24 渲染：成就提示卡 + 皮肤配色不抛异常', () => {
  const h = H.createHarness();
  const g = h.Game;
  h.App.start();
  g.achToast = { name: '测试成就', desc: '这是一条描述', time: 1.5, max: h.Config.ACH_TOAST_TIME };
  assert.doesNotThrow(() => h.Renderer.render(0.5, 1.2));
  assert.doesNotThrow(() => h.Renderer.render(1, 2.4));
  g.achToast = null;
  assert.doesNotThrow(() => h.Renderer.render(0.5, 3.6));
});

test('17.25 端到端：无尽模式跑 3000 帧不抛异常且蛇确实变长', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('endless');
  h.App.start();
  const len0 = g.snake.length;

  const KEY_OF = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  let maxLen = len0;
  for (let i = 0; i < 3000; i++) {
    // 随机乱走几乎吃不到食物，这里让蛇朝食物走（避开必死方向）
    if (i % 7 === 0) h.key(KEY_OF[H.autoPickDir(h, true)]);
    h.pump();
    if (g.state === h.STATE.GAMEOVER) { h.clickPanelBtn(); }   // 重开会重置长度，故取历史最大值
    if (g.awaitingUpgrade) h.UI.pickUpgrade(0);
    if (g.snake.length > maxLen) maxLen = g.snake.length;
  }
  assert.ok(maxLen > len0, `无尽模式下蛇应变长（起始 ${len0}，最长 ${maxLen}）`);
  assert.deepStrictEqual(h.consoleLog, [], '运行期不应出现 console 输出');
});

test('17.26 端到端：限时模式从头跑到结算，全程不抛异常', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('timeattack');
  h.App.start();
  assert.strictEqual(g.timeLeft, h.Config.TIME_ATTACK_SEC);

  // 蛇朝一个方向走，60 秒内会先撞墙而不是等到时间到；
  // 这里要验证的是「时间到」的结算路径，所以把剩余时间压到 2 秒再跑完
  g.timeLeft = 2.0;
  let guard = 0;
  while (g.state !== h.STATE.GAMEOVER && guard++ < 500) {
    h.pump();
  }
  assert.strictEqual(g.state, h.STATE.GAMEOVER, '时间到应结算');
  assert.strictEqual(g.deathReason, 'timeup');
  assert.strictEqual(h.Stats.data.games >= 1, true, '结算应计入统计');
  assert.deepStrictEqual(h.consoleLog, [], '运行期不应出现 console 输出');
});

test('17.27 排行榜记录所属模式', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.setMode('timeattack');
  h.App.start();
  g.score = 42;
  H.killPlayer(h);

  const raw = h.storageMap().get('snake-leaderboard');
  assert.ok(raw, '成绩应入榜');
  const list = JSON.parse(raw);
  assert.strictEqual(list[0].mode, 'timeattack', '记录应带上模式');

  // 榜单 Top10 在独立排行榜面板渲染，进入 LEADERBOARD 态再检查模式标签
  g.state = h.STATE.LEADERBOARD;
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('限时'), '榜单行应显示模式名');
});

test('17.28 切换到其他模式后重开：闯关残留被清空', () => {
  const h = H.createHarness();
  const g = h.Game;
  h.App.start();                 // 闯关
  g.stage = 3;
  g.spawnBoss();
  g.spawnHazards(h.Config.HAZARD_COUNT);
  assert.ok(g.bosses.length > 0 && g.hazards.length > 0);

  g.setMode('endless');
  h.App.restart();
  assert.strictEqual(g.stageMode, false);
  assert.strictEqual(g.bosses.length, 0, '切到无尽应清掉 Boss');
  assert.strictEqual(g.hazards.length, 0, '切到无尽应清掉毒区');
  assert.strictEqual(g.obstacles.length, 0, '无尽模式不生成障碍');
  assert.strictEqual(g.timeLeft, 0);
});
