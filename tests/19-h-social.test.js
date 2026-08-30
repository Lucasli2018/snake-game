/**
 * 运行：cd tests && node --test
 *
 * 19 - H 轮：社交分享（零后端）
 * 覆盖：
 *   - Share 分享码：encode 前缀 / 编解码往返一致 / 容错（空·非法·截断·版本不符）
 *   - Share 字段边界：负数/超大值被夹紧到合法范围
 *   - FriendsBoard 好友榜：add / list / remove / 去重 / 按分数降序 / 非法码拒绝
 *   - Game.buildShareRun：把本局成绩打包成 runData，模式映射正确
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

// 注意：Share/FriendsBoard 返回的对象在 vm 沙箱 realm 内创建，与主测试 realm 的
// Object.prototype 不同；eq 会校验 [[Prototype]] 而误报，
// 这里统一用宽松的 assert.deepEqual（只比对自身可枚举属性与值）。
const eq = (actual, expected, msg) => assert.deepEqual(actual, expected, msg);

const PREFIX = 'SNK1-';

// 一条典型的本局成绩
function sampleRun(over) {
  return Object.assign(
    { v: 1, m: 0, s: 120, l: 15, t: 42, b: 2, c: 8, a: 3 },
    over || {}
  );
}

/* ================================================================== *
 * 1. Share 分享码
 * ================================================================== */
test('19.1 Share.encode 产出带 SNK1- 前缀的字符串', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun());
  assert.strictEqual(typeof code, 'string');
  assert.ok(code.startsWith(PREFIX), '分享码应以 SNK1- 前缀开头，实际：' + code);
});

test('19.2 encode → decode 往返一致', () => {
  const h = H.createHarness();
  const run = sampleRun({ m: 1, s: 999, l: 33, t: 777, b: 4, c: 12, a: 7 });
  const code = h.Share.encode(run);
  const back = h.Share.decode(code);
  assert.ok(back, 'decode 应成功');
  eq(back, {
    v: 1, m: 1, s: 999, l: 33, t: 777, b: 4, c: 12, a: 7
  });
});

test('19.3 decode 对空/非字符串/无前缀一律返回 null（不抛异常）', () => {
  const h = H.createHarness();
  assert.strictEqual(h.Share.decode(null), null);
  assert.strictEqual(h.Share.decode(undefined), null);
  assert.strictEqual(h.Share.decode(''), null);
  assert.strictEqual(h.Share.decode(12345), null);
  assert.strictEqual(h.Share.decode('XYZ-abcdef'), null);   // 前缀不对
  assert.strictEqual(h.Share.decode('随便一段中文'), null);
});

test('19.4 decode 对截断/损坏的 base64 返回 null', () => {
  const h = H.createHarness();
  // 合法前缀 + 一段明显非 base64 的乱码
  assert.strictEqual(h.Share.decode(PREFIX + '!!!not_base64!!!'), null);
  // 合法前缀但内容被截掉一半
  const good = h.Share.encode(sampleRun());
  const broken = good.slice(0, good.length - 4);
  assert.strictEqual(h.Share.decode(broken), null);
});

test('19.5 decode 拒绝版本不符（仅支持当前版本）', () => {
  const h = H.createHarness();
  // 当前版本为 1；手工编码一个 v=2 的码，decode 应拒绝
  const future = h.Share.encode(sampleRun({ v: 2 }));
  assert.strictEqual(h.Share.decode(future), null);
  // 版本过低同样拒绝
  const old = h.Share.encode(sampleRun({ v: 0 }));
  assert.strictEqual(h.Share.decode(old), null);
});

test('19.6 decode 将负数/超大值夹紧到合法范围', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun({ m: 1, s: 50, l: -5, t: -100, b: 3, c: 99999, a: 250 }));
  const back = h.Share.decode(code);
  assert.ok(back);
  assert.strictEqual(back.l, 0, '长度负数应夹到 0');
  assert.strictEqual(back.t, 0, '时长负数应夹到 0');
  assert.strictEqual(back.c, 9999, '连击超大应夹到上限 9999');
  assert.strictEqual(back.a, 99, '成就数超大应夹到上限 99');
  assert.strictEqual(back.m, 1, '模式应在合法范围');
  assert.strictEqual(back.s, 50);
});

test('19.7 分享码长度合理（< 200 字符，便于复制传播）', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun({ m: 2, s: 123456, l: 99, t: 6543, b: 9, c: 88, a: 12 }));
  assert.ok(code.length < 200, '分享码过长：' + code.length);
});

/* ================================================================== *
 * 2. FriendsBoard 好友榜
 * ================================================================== */
test('19.8 FriendsBoard.add 合法分享码 → 成功并写入本地', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun({ m: 0, s: 120, l: 15, t: 42, b: 2, c: 8, a: 3 }));
  const res = h.FriendsBoard.add(code);
  assert.strictEqual(res.ok, true, 'add 应成功：' + JSON.stringify(res));
  const list = h.FriendsBoard.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].code, code);
  eq(list[0].data, {
    v: 1, m: 0, s: 120, l: 15, t: 42, b: 2, c: 8, a: 3
  });
});

test('19.9 FriendsBoard.add 重复码返回 dup 且不重复写入', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun({ s: 80 }));
  assert.strictEqual(h.FriendsBoard.add(code).ok, true);
  const dup = h.FriendsBoard.add(code);
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.reason, 'dup');
  assert.strictEqual(h.FriendsBoard.list().length, 1);
});

test('19.10 FriendsBoard.add 非法码返回 invalid', () => {
  const h = H.createHarness();
  const res = h.FriendsBoard.add('这不是分享码');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'invalid');
});

test('19.11 FriendsBoard.add 空输入返回 empty', () => {
  const h = H.createHarness();
  assert.strictEqual(h.FriendsBoard.add('').ok, false);
  assert.strictEqual(h.FriendsBoard.add(null).reason, 'empty');
  assert.strictEqual(h.FriendsBoard.add('   ').reason, 'empty');
});

test('19.12 FriendsBoard.list 按分数降序排列', () => {
  const h = H.createHarness();
  h.FriendsBoard.add(h.Share.encode(sampleRun({ s: 100 })));
  h.FriendsBoard.add(h.Share.encode(sampleRun({ s: 300 })));
  h.FriendsBoard.add(h.Share.encode(sampleRun({ s: 200 })));
  const scores = h.FriendsBoard.list().map((it) => it.data.s);
  eq(scores, [300, 200, 100]);
});

test('19.13 FriendsBoard.remove 按分享码删除', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun({ s: 150 }));
  h.FriendsBoard.add(code);
  assert.strictEqual(h.FriendsBoard.list().length, 1);
  const after = h.FriendsBoard.remove(code);
  assert.strictEqual(after.length, 0);
  assert.strictEqual(h.FriendsBoard.list().length, 0);
});

test('19.14 FriendsBoard.list 读取时自动去重（同码多条只保留一条）', () => {
  const h = H.createHarness();
  const code = h.Share.encode(sampleRun({ s: 66 }));
  // 模拟本地存储里出现两条相同 code 的脏数据
  const dirty = JSON.stringify([
    { code: code, data: h.Share.decode(code), importedAt: 1 },
    { code: code, data: h.Share.decode(code), importedAt: 2 }
  ]);
  h.Storage.set(h.Config.STORAGE_FRIENDS, dirty);
  assert.strictEqual(h.FriendsBoard.list().length, 1, '同码应去重为一条');
});

/* ================================================================== *
 * 3. Game.buildShareRun
 * ================================================================== */
test('19.15 buildShareRun 把本局成绩打包成 runData，模式映射正确', () => {
  const h = H.createHarness();
  h.Game.mode = 'endless';
  h.Game.score = 240;
  h.Game.snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]; // length 3
  h.Game._runDuration = 37;
  h.Game.runBossKills = 1;
  h.Game.comboBest = 5;
  // 成就：解锁 2 项
  h.Achievements.unlock('first-game');
  h.Achievements.unlock('score-500');
  const run = h.Game.buildShareRun();
  assert.strictEqual(run.v, 1);
  assert.strictEqual(run.m, 1, 'endless 应映射到索引 1');
  assert.strictEqual(run.s, 240);
  assert.strictEqual(run.l, 3);
  assert.strictEqual(run.t, 37);
  assert.strictEqual(run.b, 1);
  assert.strictEqual(run.c, 5);
  assert.strictEqual(run.a, 2, '应统计已解锁成就数');
});

test('19.16 buildShareRun → Share 往返：编出的码可被好友榜识别', () => {
  const h = H.createHarness();
  h.Game.mode = 'timeattack';
  h.Game.score = 88;
  h.Game.snake = [{ x: 0, y: 0 }];
  h.Game._runDuration = 60;
  h.Game.runBossKills = 0;
  h.Game.comboBest = 0;
  const code = h.Share.encode(h.Game.buildShareRun());
  assert.ok(code.startsWith(PREFIX));
  const res = h.FriendsBoard.add(code);
  assert.strictEqual(res.ok, true, '自己本局的分享码应能被好友榜正常导入');
  assert.strictEqual(res.data.m, 2, 'timeattack 应映射到索引 2');
});

test('19.17 SOCIAL 面板渲染：含好友榜输入/导入按钮，且不会抛异常', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.SOCIAL;
  assert.doesNotThrow(() => h.UI.syncOverlay(), 'SOCIAL 面板 syncOverlay 应无异常');
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('好友榜'), 'SOCIAL 面板应显示「好友榜」');
  assert.ok(h.els.get('friendCode'), '应有 friendCode 输入框');
  assert.ok(h.els.get('ovImport'), '应有 ovImport 导入按钮');
  assert.ok(h.els.get('ovBack'), '应有 ovBack 返回按钮');
});

test('19.18 模拟「导入」：粘贴合法分享码后好友榜新增且提示成功', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.SOCIAL;
  h.UI.syncOverlay();
  const code = h.Share.encode(sampleRun({ s: 77, l: 9, t: 25, b: 1, c: 4, a: 2 }));
  const input = h.els.get('friendCode');
  input.value = code;            // 模拟用户在输入框粘贴
  h.UI.onImportFriend();
  const list = h.FriendsBoard.list();
  assert.strictEqual(list.length, 1, '导入后好友榜应有 1 条');
  assert.strictEqual(list[0].data.s, 77);
  const msg = h.els.get('friendMsg');
  assert.ok(/已导入/.test(msg.textContent), '应提示导入成功，实际：' + msg.textContent);
  assert.ok(/ok/.test(msg.className), '成功提示应有 ok 样式');
});
