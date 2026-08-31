/**
 * 运行：cd tests && node --test
 *
 * 22 - 元进度天赋树（I 轮 · 跨局永久成长）
 * 覆盖：
 *   - Meta 默认数据：星屑 0、所有天赋 0 级（恒等效果，不破坏旧行为）
 *   - 升级：扣减星屑、等级 +1；星屑不足 / 已满级 拒绝
 *   - 各效果 getter 数值正确（强身 / 贪婪之魂 / 连击感知 / 幸运星 / 稳健 / 长蛇）
 *   - Game 接入后：初始生命 / 连击窗口 / 得分倍率 / 基础速度 / 特殊食物间隔 / 起步长度 随天赋变化
 *   - 天赋面板 UI：开始屏「🌟 天赋」按钮、进入 TALENTS 态、升级扣星屑并刷新、Esc 返回、primaryAction 不误开始
 *   - 结算：本局获得星屑并累加进 Meta
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('22.1 Meta 默认数据恒等：星屑 0、天赋全 0 级、效果 getter 不改变旧行为', () => {
  const h = H.createHarness();
  assert.strictEqual(h.Meta.stardust(), 0, '默认星屑应为 0');
  for (const d of h.TALENTS) {
    assert.strictEqual(h.Meta.rank(d.id), 0, d.id + ' 默认等级应为 0');
    assert.strictEqual(h.Meta.maxed(d.id), false, d.id + ' 默认不应满级');
  }
  assert.strictEqual(h.Meta.startLivesBonus(), 0, '强身默认 +0 生命');
  assert.strictEqual(h.Meta.scoreBonus(), 0, '贪婪之魂默认 +0% 得分');
  assert.strictEqual(h.Meta.comboWindowBonus(), 0, '连击感知默认 +0s');
  assert.strictEqual(h.Meta.specialIntervalMul(), 1, '幸运星默认间隔系数 1');
  assert.strictEqual(h.Meta.calmBaseLevel(), 0, '稳健默认 +0 速度等级');
  assert.strictEqual(h.Meta.startLenBonus(), 0, '长蛇默认 +0 节');
  // Game 接入：默认天赋下行为与旧版一致
  h.Game.reset();
  assert.strictEqual(h.Game.lives, h.Config.START_LIVES, '默认天赋下初始生命=START_LIVES');
  assert.strictEqual(h.Game.snake.length, h.Config.START_LEN, '默认天赋下起步长度=START_LEN');
  assert.strictEqual(h.Game.scoreMul, 1, '默认天赋下得分倍率=1');
});

test('22.2 升级成功扣减星屑并提升等级；星屑不足 / 已满级 拒绝', () => {
  const h = H.createHarness();
  const def = h.TALENTS[0]; // startLife，cost [20,45]
  // 星屑不足：0 < 20，拒绝
  assert.strictEqual(h.Meta.canUpgrade(def.id), false, '星屑不足时不可升级');
  assert.strictEqual(h.Meta.upgrade(def.id), false, '星屑不足时 upgrade 返回 false');
  assert.strictEqual(h.Meta.rank(def.id), 0, '升级失败等级不变');
  // 注入 20 星屑，升 1 级
  h.Meta.addStardust(20);
  assert.strictEqual(h.Meta.canUpgrade(def.id), true, '星屑足够时应可升级');
  assert.strictEqual(h.Meta.upgrade(def.id), true, 'upgrade 应成功');
  assert.strictEqual(h.Meta.rank(def.id), 1, '升级后等级应为 1');
  assert.strictEqual(h.Meta.stardust(), 0, '升级后星屑应扣为 0（20 - 20）');
  // 再注入 45 升满（max=2），第 3 次应拒绝
  h.Meta.addStardust(45);
  assert.strictEqual(h.Meta.upgrade(def.id), true, '第二次升级应成功');
  assert.strictEqual(h.Meta.rank(def.id), 2, '应达到最大等级 2');
  assert.strictEqual(h.Meta.maxed(def.id), true, '满级后应 maxed=true');
  assert.strictEqual(h.Meta.cost(def.id), null, '满级后 cost 应为 null');
  h.Meta.addStardust(999);
  assert.strictEqual(h.Meta.upgrade(def.id), false, '已满级再升级应拒绝');
  assert.strictEqual(h.Meta.rank(def.id), 2, '满级后等级不再增加');
});

test('22.3 各效果 getter 数值正确', () => {
  const h = H.createHarness();
  // scoreBonus: 每级 +5%，3 级 = 0.15（一次给足，避免中途星屑耗尽）
  h.Meta.addStardust(2000);
  h.Meta.upgrade('scoreBonus'); h.Meta.upgrade('scoreBonus'); h.Meta.upgrade('scoreBonus');
  assert.ok(Math.abs(h.Meta.scoreBonus() - 0.15) < 1e-9, '贪婪之魂 3 级应为 +15%');
  // comboWindow: 每级 +1s，2 级 = 2
  h.Meta.upgrade('comboWindow'); h.Meta.upgrade('comboWindow');
  assert.strictEqual(h.Meta.comboWindowBonus(), 2, '连击感知 2 级应为 +2s');
  // specialFreq: 每级间隔 ×0.8，2 级 = 0.6
  h.Meta.upgrade('specialFreq'); h.Meta.upgrade('specialFreq');
  assert.ok(Math.abs(h.Meta.specialIntervalMul() - 0.6) < 1e-9, '幸运星 2 级间隔系数应为 0.6');
  // startLife / startLen 各 +1/级
  h.Meta.upgrade('startLife'); h.Meta.upgrade('startLen');
  assert.strictEqual(h.Meta.startLivesBonus(), 1, '强身 1 级 +1 生命');
  assert.strictEqual(h.Meta.startLenBonus(), 1, '长蛇 1 级 +1 节');
  // calmBase: 每级 +1 calmLevel
  h.Meta.upgrade('calmBase');
  assert.strictEqual(h.Meta.calmBaseLevel(), 1, '稳健 1 级 +1 速度等级');
});

test('22.4 Game 接入天赋：初始生命 / 连击窗口 / 得分倍率 / 起步长度随天赋变化', () => {
  const h = H.createHarness();
  h.Meta.addStardust(1000);
  // startLife +2，scoreBonus +15%，comboWindow +3，startLen +2，calmBase +2
  h.Meta.upgrade('startLife'); h.Meta.upgrade('startLife');
  h.Meta.upgrade('scoreBonus'); h.Meta.upgrade('scoreBonus'); h.Meta.upgrade('scoreBonus');
  h.Meta.upgrade('comboWindow'); h.Meta.upgrade('comboWindow'); h.Meta.upgrade('comboWindow');
  h.Meta.upgrade('startLen'); h.Meta.upgrade('startLen');
  h.Meta.upgrade('calmBase'); h.Meta.upgrade('calmBase');
  h.Game.reset();
  assert.strictEqual(h.Game.lives, h.Config.START_LIVES + 2, '初始生命应 +2');
  assert.strictEqual(h.Game.maxLives, h.Config.START_LIVES + 2, '生命上限应同步 +2');
  assert.ok(Math.abs(h.Game.scoreMul - 1.15) < 1e-9, '得分倍率应为 1.15');
  assert.strictEqual(h.Game.comboWindow, h.Config.COMBO_WINDOW + 3, '连击窗口应 +3s');
  assert.strictEqual(h.Game.snake.length, h.Config.START_LEN + 2, '起步长度应 +2 节');
  assert.strictEqual(h.Game.calmLevel, 2, 'calmLevel 应为 2');
  // 特殊食物刷新间隔受幸运星影响（此处未升 specialFreq，应保持默认）
  assert.strictEqual(h.Game.specialInterval, h.Config.SPECIAL_SPAWN_INTERVAL, '未升幸运星时间隔不变');
});

test('22.5 幸运星缩短特殊食物刷新间隔', () => {
  const h = H.createHarness();
  h.Meta.addStardust(1000);
  h.Meta.upgrade('specialFreq'); h.Meta.upgrade('specialFreq'); h.Meta.upgrade('specialFreq');
  h.Game.reset();
  const expect = Math.round(h.Config.SPECIAL_SPAWN_INTERVAL * 0.4);
  assert.strictEqual(h.Game.specialInterval, expect, '3 级幸运星间隔应 ×0.4');
});

test('22.6 开始屏含「🌟 天赋」按钮，进入 TALENTS 独立面板', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('id="ovTalent"'), '开始屏应有天赋按钮 ovTalent');
  assert.ok(html.includes('🌟 天赋'), '天赋按钮文案应显示');
  const tBtn = h.els.get('ovTalent');
  assert.ok(tBtn, '应找到 ovTalent 按钮');
  tBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(h.Game.state, h.STATE.TALENTS, '点「🌟 天赋」应进入 TALENTS 态');
  const panel = h.els.get('panel').innerHTML;
  assert.ok(panel.includes('id="talentUp0"'), '天赋面板应渲染天赋卡');
  assert.ok(panel.includes('当前星屑'), '天赋面板应显示星屑余额');
});

test('22.7 天赋面板升级扣星屑并刷新面板', () => {
  const h = H.createHarness();
  h.Meta.addStardust(100);
  h.Game.state = h.STATE.TALENTS;
  h.UI.syncOverlay();
  const before = h.Meta.stardust();
  const up0 = h.els.get('talentUp0');
  assert.ok(up0, '应有 talentUp0 按钮');
  up0.dispatchEvent({ type: 'click' });
  assert.strictEqual(h.Meta.stardust(), before - h.TALENTS[0].cost[0], '升级后星屑应扣除首级花费');
  assert.strictEqual(h.Meta.rank('startLife'), 1, 'startLife 应升到 1 级');
});

test('22.8 TALENTS 态不误开始：primaryAction 无效，Esc 返回开始屏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.TALENTS;
  h.UI.syncOverlay();
  h.App.primaryAction();
  assert.strictEqual(h.Game.state, h.STATE.TALENTS, 'TALENTS 态空格/Enter 不应开始');
  if (h.Input && h.Input.onKeyDown) {
    h.Input.onKeyDown({ key: 'Escape', code: 'Escape', preventDefault() {} });
  } else {
    h.App.showStart();
  }
  assert.strictEqual(h.Game.state, h.STATE.READY, 'Esc 应回到开始屏');
});

test('22.9 结算：本局获得星屑并累加进 Meta', () => {
  const h = H.createHarness();
  assert.strictEqual(h.Meta.stardust(), 0, '初始星屑 0');
  // 构造一局：得分 200、最高连击 5、击破 1 Boss、通关、新纪录
  h.Game.score = 200;
  h.Game.comboBest = 5;
  h.Game.runBossKills = 1;
  h.Game.win = true;
  h.Game.isRecord = true;
  const earned = h.Meta.earnedFor(h.Game);
  // 200/20=10 + 5*2=10 + 1*5=5 + 通关30 + 新纪录15 = 70
  assert.strictEqual(earned, 70, '应得星屑应为 70，实际 ' + earned);
  h.Game.gameOver();
  assert.strictEqual(h.Meta.stardust(), 70, '结算后星屑应累加为 70');
  assert.strictEqual(h.Game._lastEarned, 70, '_lastEarned 应记录 70');
  // 再次结算（非纪录、非通关）不应重复计入，但新一局会再加
  h.Game.score = 100; h.Game.comboBest = 0; h.Game.runBossKills = 0;
  h.Game.win = false; h.Game.isRecord = false;
  const e2 = h.Meta.earnedFor(h.Game); // 100/20 = 5
  assert.strictEqual(e2, 5, '第二局应得 5 星屑');
});

test('22.10 脏数据 / 隐私模式：Meta 静默兜底为默认', () => {
  // 隐私模式（Storage 写入被拒绝）下：读取兜底默认、写入不抛异常、且不持久化
  const h = H.createHarness({ storage: 'throw' });
  assert.strictEqual(h.Meta.stardust(), 0, '隐私 Storage 下星屑兜底 0');
  for (const d of h.TALENTS) {
    assert.strictEqual(h.Meta.rank(d.id), 0, d.id + ' 隐私 Storage 下等级兜底 0');
  }
  // 隐私模式下 addStardust 不抛异常
  assert.doesNotThrow(() => h.Meta.addStardust(50), '隐私模式写入不应抛异常');
  assert.strictEqual(h.Meta.stardust(), 0, '隐私模式写入后仍为 0（未持久化）');

  // 脏数据（Storage 里是非 JSON 垃圾）：load 兜底默认
  const g = H.createHarness({ storage: 'garbage' });
  assert.strictEqual(g.Meta.stardust(), 0, '脏 Storage 下星屑兜底 0');
  for (const d of g.TALENTS) {
    assert.strictEqual(g.Meta.rank(d.id), 0, d.id + ' 脏 Storage 下等级兜底 0');
  }
});
