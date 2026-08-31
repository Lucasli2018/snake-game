/**
 * J 轮：每日挑战 + 每日榜
 * - 每日种子 / 修饰确定性（同图基础）
 * - 棋盘生成用播种 rng（同日期同种子 -> 初始食物位置一致）
 * - 每日修饰正确叠加
 * - 每日榜记录 / 名次 / 连续打卡（同图公平 + 回流激励）
 * - startDaily 进入挑战、普通 start 清除 daily 标志
 * - UI 渲染不报错
 */
'use strict';

const test = require('node:test');
const H = require('./harness');
const assert = require('assert');

test('23.1 每日种子与修饰确定性', () => {
  const h = H.createHarness();
  const D = h.Daily;
  // 同日期种子一致
  assert.strictEqual(D.seedFor('2026-08-31'), D.seedFor('2026-08-31'));
  // 不同日期种子不同
  assert.notStrictEqual(D.seedFor('2026-08-31'), D.seedFor('2026-09-01'));
  // 同日期修饰一致
  const m1 = D.modsFor('2026-08-31');
  const m2 = D.modsFor('2026-08-31');
  assert.deepStrictEqual(m1, m2);
  // 数量符合配置，且每个 id 都真实存在
  assert.strictEqual(m1.length, h.Config.DAILY_MOD_COUNT);
  for (const id of m1) assert.ok(h.DAILY_MODS[id], '修饰 id 必须存在: ' + id);
});

test('23.2 makeRng 同种子同序列、异种子异序列', () => {
  const h = H.createHarness();
  const r1 = h.Daily.makeRng(12345);
  const r2 = h.Daily.makeRng(12345);
  let same = true;
  for (let i = 0; i < 20; i++) if (r1() !== r2()) same = false;
  assert.ok(same, '同种子应产生相同序列');
  const r3 = h.Daily.makeRng(999);
  assert.notStrictEqual(r3(), r1(), '不同种子首值应不同');
});

test('23.3 同日期同种子 -> 初始食物位置一致（同图）；不同日期 -> 不同', () => {
  const h = H.createHarness();
  const seed = h.Daily.seedFor('2026-08-31');
  const mods = h.Daily.modsFor('2026-08-31');
  function dailyFood(key) {
    h.Game.daily = true;
    h.Game.dailySeed = h.Daily.seedFor(key);
    h.Game.dailyMods = h.Daily.modsFor(key);
    h.Game.mode = 'stage';
    h.Game.reset();
    return { x: h.Game.food.x, y: h.Game.food.y };
  }
  const a = dailyFood('2026-08-31');
  const b = dailyFood('2026-08-31');
  assert.deepStrictEqual(a, b, '同日期同种子应生成完全相同初始食物（同图）');
  const c = dailyFood('2026-09-01');
  assert.notDeepStrictEqual(a, c, '不同日期初始食物应不同');
});

test('23.4 每日修饰正确叠加', () => {
  const h = H.createHarness();
  const g = h.Game;
  g.scoreMul = 1;
  h.DAILY_MODS.greed.apply(g);
  assert.ok(Math.abs(g.scoreMul - 1.5) < 1e-9, 'greed 应让得分 ×1.5');

  g.dailyObsBonus = 0;
  h.DAILY_MODS.thorns.apply(g);
  assert.strictEqual(g.dailyObsBonus, 3, 'thorns 应让每关障碍 +3');

  g.calmLevel = 0;
  h.DAILY_MODS.calm.apply(g);
  assert.strictEqual(g.calmLevel, 1, 'calm 应 -0.8 基础速度（calmLevel +1）');

  g.calmLevel = 0;
  h.DAILY_MODS.swift.apply(g);
  assert.strictEqual(g.calmLevel, -1, 'swift 应 +0.8 基础速度（calmLevel -1）');

  g.dailyHazardMul = 1;
  h.DAILY_MODS.toxic.apply(g);
  assert.strictEqual(g.dailyHazardMul, 2, 'toxic 应让毒区 ×2');

  g.dailyNoShield = false; g.shieldLevel = 1;
  h.DAILY_MODS.noShield.apply(g);
  assert.strictEqual(g.dailyNoShield, true, 'noShield 应置位');
  assert.strictEqual(g.shieldLevel, 0, 'noShield 应清空护盾等级');
});

test('23.5 每日榜记录 / 名次 / 排序', () => {
  const h = H.createHarness();
  const D = h.Daily;
  h.storageMap().clear();
  const r1 = D.record({ name: 'A', score: 100, duration: 10, mode: 'daily' });
  assert.strictEqual(r1.rank, 1);
  assert.strictEqual(r1.total, 1);

  const r2 = D.record({ name: 'B', score: 200, duration: 12, mode: 'daily' });
  assert.strictEqual(r2.rank, 1, 'B 分高应排第一');
  assert.strictEqual(r2.total, 2);

  const list = D.list();
  assert.strictEqual(list[0].name, 'B');
  assert.strictEqual(list[0].score, 200);
  assert.strictEqual(list[1].name, 'A');
});

test('23.6 连续打卡：同一天再玩不重复计数，且有星屑加成', () => {
  const h = H.createHarness();
  const D = h.Daily;
  h.storageMap().clear();
  // 先打一次卡建立连续 1 天
  D.record({ name: 'X', score: 50, duration: 5, mode: 'daily' });

  // 同一天再开一局每日挑战并结算
  h.Game.daily = true;
  h.Game.dailySeed = D.seedFor('2026-08-31');
  h.Game.dailyMods = D.modsFor('2026-08-31');
  h.Game.mode = 'stage';
  h.Game.reset();
  h.Game.score = 200;
  h.Game.comboBest = 5;
  h.Game._runDuration = 30;
  h.Game.gameOver();

  assert.ok(h.Game._dailyResult, '应写入每日结果');
  assert.strictEqual(h.Game._dailyResult.streak.count, 1, '同一天再玩不应重复计数');
  assert.ok(Math.abs(h.Game._dailyResult.streak.bonusPct - 0.1) < 1e-9, '1 天打卡星屑加成 10%');

  // 本局星屑应 = 基础星屑 × (1 + 加成)
  const base = h.Meta.earnedFor(h.Game);
  assert.strictEqual(h.Game._lastEarned, Math.round(base * (1 + 0.1)), '结算星屑应含连续打卡加成');
  assert.strictEqual(h.Meta.stardust(), h.Game._lastEarned, 'Meta 应累加本局星屑');
});

test('23.7 每日榜 UI 渲染不报错', () => {
  const h = H.createHarness();
  const modsHtml = h.UI.renderDailyMods();
  assert.ok(typeof modsHtml === 'string' && modsHtml.length > 0);
  assert.ok(modsHtml.indexOf('daily-mod') >= 0, '应渲染修饰 chips');
  const blockHtml = h.UI.renderDailyBlock();
  assert.ok(blockHtml.indexOf('今日榜') >= 0, '应渲染今日榜标题');
});

test('23.8 startDaily 进入挑战；普通 start 清除 daily 标志', () => {
  const h = H.createHarness();
  h.App.startDaily();
  assert.strictEqual(h.Game.daily, true, 'startDaily 应标记 daily');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
  assert.ok(h.Game.dailySeed !== 0, '应有每日种子');
  assert.ok(Array.isArray(h.Game.dailyMods) && h.Game.dailyMods.length > 0, '应有每日修饰');

  // 回到 READY 后用普通「开始游戏」，应清除 daily 标志
  h.Game.state = h.STATE.READY;
  h.Game.mode = 'stage';
  h.App.start();
  assert.strictEqual(h.Game.daily, false, '普通 start 应清除 daily 标志');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING);
});
