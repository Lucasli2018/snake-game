/**
 * 运行：cd tests && node --test
 *
 * 06 - localStorage 兜底（隐私模式 / file:// 协议下会抛错）
 * 覆盖：
 *   - localStorage 完全不存在（undefined）
 *   - getItem / setItem 抛异常（Safari 隐私模式、配额超限）
 *   - 返回脏数据（null / '' / 'abc' / '-5' / 'NaN' / 超大数）
 *   - 以上任何一种情况下：初始化、游戏结束结算、音效开关都不能抛未捕获异常
 *   - 正常路径下最高分确实能持久化
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/* ================================================================== *
 * 1. 各种坏掉的 localStorage 都不该让游戏崩溃
 * ================================================================== */
test('06.1 localStorage 为 undefined（部分 file:// 环境）时启动不抛异常', () => {
  assert.doesNotThrow(() => H.createHarness({ storage: 'undefined' }));
  const h = H.createHarness({ storage: 'undefined' });
  assert.strictEqual(h.Game.best, 0, '读不到存储时最高分应为 0');
  assert.strictEqual(h.Game.state, h.STATE.READY);
});

test('06.2 localStorage 读写抛异常时，初始化 / 结算 / 音效开关都不崩溃', () => {
  assert.doesNotThrow(() => H.createHarness({ storage: 'throw' }));
  const h = H.createHarness({ storage: 'throw' });
  assert.strictEqual(h.Game.best, 0);

  // 游戏结束结算会写最高分
  h.startPlaying();
  h.Game.score = 999;
  assert.doesNotThrow(() => h.Game.gameOver(), '写入失败时 gameOver 不应抛异常');
  assert.strictEqual(h.Game.best, 999, '写入失败也应保留内存中的最高分');
  assert.strictEqual(h.Game.isRecord, true);

  // 音效开关会写 muted 状态
  assert.doesNotThrow(() => h.clickSound(), '音效开关写存储失败不应抛异常');
});

test('06.3 Storage.get / Storage.set 本身永不抛异常', () => {
  const h = H.createHarness({ storage: 'throw' });
  const S = h.Storage;

  assert.doesNotThrow(() => S.get('whatever', 'fallback'));
  assert.strictEqual(S.get('whatever', 'fallback'), 'fallback');
  assert.strictEqual(S.set('k', 'v'), false, '写入失败应返回 false 而不是抛出');

  const h2 = H.createHarness({ storage: 'undefined' });
  assert.doesNotThrow(() => h2.Storage.get('k', 'fb'));
  assert.strictEqual(h2.Storage.get('k', 'fb'), 'fb');
  assert.strictEqual(h2.Storage.set('k', 'v'), false);
});

test('06.4 连续玩 100 局（每局都会尝试写最高分）在坏存储下不崩溃', () => {
  const h = H.createHarness({ storage: 'throw' });
  for (let i = 0; i < 100; i++) {
    h.startPlaying();
    h.Game.score = i * 10;
    assert.doesNotThrow(() => h.Game.gameOver());
  }
  assert.strictEqual(h.Game.best, 990);
});

test('06.5 坏存储下完整跑 500 帧主循环，不抛异常、无 console 输出', () => {
  const h = H.createHarness({ storage: 'throw' });
  h.startPlaying();
  assert.doesNotThrow(() => h.pumpFrames(500));
  assert.deepStrictEqual(h.consoleLog, [], '不应有任何 console 输出（说明异常被吞掉时打了日志）');
});

/* ================================================================== *
 * 2. 脏数据兜底
 * ================================================================== */
test('06.6 最高分脏数据一律回退为 0，不会变成 NaN', () => {
  const cases = [
    { raw: 'abc', expect: 0 },
    { raw: '', expect: 0 },
    { raw: '   ', expect: 0 },
    { raw: '-5', expect: 0 },
    { raw: '-1000', expect: 0 },
    { raw: 'NaN', expect: 0 },
    { raw: '12abc', expect: 12 },        // parseInt 的合法前缀解析
    { raw: '0', expect: 0 },
    { raw: '250', expect: 250 },
    { raw: '999999999', expect: 999999999 }
  ];

  for (const c of cases) {
    const h = H.createHarness({
      storage: 'ok',
      storageSeed: { 'snake-game.best.v1': c.raw }
    });
    assert.ok(Number.isInteger(h.Game.best), `原始值 "${c.raw}" 解析出了非整数 ${h.Game.best}`);
    assert.strictEqual(h.Game.best, c.expect,
      `存储值 "${c.raw}" 应解析为 ${c.expect}，实际 ${h.Game.best}`);
    assert.ok(!Number.isNaN(h.Game.best), `存储值 "${c.raw}" 导致 best 变成 NaN`);
  }
});

test('06.7 键不存在（getItem 返回 null）时回退为 0', () => {
  const h = H.createHarness({ storage: 'ok', storageSeed: {} });
  assert.strictEqual(h.Game.best, 0);
});

test('06.8 best 为 NaN 时 HUD 不会显示 "NaN"', () => {
  const h = H.createHarness({ storageSeed: { 'snake-game.best.v1': 'abc' } });
  h.UI.updateHud();
  assert.notStrictEqual(h.els.get('bestEl').textContent, 'NaN');
  assert.strictEqual(h.els.get('bestEl').textContent, '0');
});

/* ================================================================== *
 * 3. 正常路径
 * ================================================================== */
test('06.9 正常存储下最高分能写入并被下一次启动读到', () => {
  const seed = {};
  const h1 = H.createHarness({ storage: 'ok', storageSeed: seed });
  h1.startPlaying();
  h1.Game.score = 320;
  h1.Game.gameOver();
  assert.strictEqual(h1.Game.best, 320);
  assert.strictEqual(h1.storageMap().get('snake-game.best.v1'), '320', '最高分应写入 localStorage');

  const h2 = H.createHarness({ storage: 'ok', storageSeed: Object.fromEntries(h1.storageMap()) });
  assert.strictEqual(h2.Game.best, 320, '新一局应读到上一局的最高分');
});

test('06.10 低于最高分时不覆盖，isRecord 为 false', () => {
  const seed = { 'snake-game.best.v1': '500' };
  const h = H.createHarness({ storage: 'ok', storageSeed: seed });
  h.startPlaying();
  h.Game.score = 100;
  h.Game.gameOver();
  assert.strictEqual(h.Game.best, 500, '低分不应覆盖最高分');
  assert.strictEqual(h.Game.isRecord, false);
  assert.strictEqual(h.storageMap().get('snake-game.best.v1'), '500');

  h.Game.score = 900;
  h.Game.gameOver();
  assert.strictEqual(h.Game.best, 900, '超过时应更新');
  assert.strictEqual(h.Game.isRecord, true);
  assert.strictEqual(h.storageMap().get('snake-game.best.v1'), '900');
});

test('06.11 得分等于最高分时不算新纪录', () => {
  const h = H.createHarness({ storageSeed: { 'snake-game.best.v1': '200' } });
  h.startPlaying();
  h.Game.score = 200;
  h.Game.gameOver();
  assert.strictEqual(h.Game.best, 200);
  assert.strictEqual(h.Game.isRecord, false, '平分不应算破纪录');
});

test('06.12 音效开关状态可持久化，且坏存储下切换不崩溃', () => {
  const seed = {};
  const h = H.createHarness({ storage: 'ok', storageSeed: seed });
  assert.strictEqual(h.Sfx.muted, false, '默认应为开启音效');

  h.clickSound();
  assert.strictEqual(h.Sfx.muted, true);
  assert.strictEqual(h.storageMap().get('snake-game.muted.v1'), '1');

  h.clickSound();
  assert.strictEqual(h.Sfx.muted, false);
  assert.strictEqual(h.storageMap().get('snake-game.muted.v1'), '0');

  // 喇叭图标状态同步
  h.clickSound();
  assert.strictEqual(h.els.get('slash').style.display, '', '静音时应显示斜杠');
  h.clickSound();
  assert.strictEqual(h.els.get('slash').style.display, 'none', '开启时应隐藏斜杠');

  // 已存的静音状态应被读回
  const h2 = H.createHarness({ storage: 'ok', storageSeed: { 'snake-game.muted.v1': '1' } });
  assert.strictEqual(h2.Sfx.muted, true, '应读回上次的静音状态');
});

test('06.13 静音状态下所有音效调用都是空操作，不创建 AudioContext', () => {
  const h = H.createHarness({ storageSeed: { 'snake-game.muted.v1': '1' } });
  assert.strictEqual(h.Sfx.muted, true);
  h.Sfx.unlock();
  assert.strictEqual(h.Sfx.ctx, null, '静音时不应创建 AudioContext');
  assert.doesNotThrow(() => {
    h.Sfx.eat(1); h.Sfx.crash(); h.Sfx.record(); h.Sfx.start(); h.Sfx.pause(true);
  });
});
