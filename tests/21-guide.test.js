/**
 * 21 - 玩法指引弹窗测试
 * 运行：cd tests && node --test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const CLICK = { stopPropagation() {}, preventDefault() {} };

test('21.1 玩法指引弹窗元素存在且初始未显示', () => {
  const h = H.createHarness();
  assert.ok(h.els.get('guideModal'), 'guideModal 应存在');
  assert.ok(h.els.get('guideBody'), 'guideBody 应存在');
  assert.ok(h.els.get('guideClose'), 'guideClose 应存在');
  assert.ok(h.els.get('guideOk'), 'guideOk 应存在');
  assert.ok(!h.UI.guideVisible, '初始 guideVisible 应为 falsy');
});

test('21.2 调用 UI.showGuide 显示弹窗并写入玩法内容', () => {
  const h = H.createHarness();
  h.UI.showGuide();
  assert.strictEqual(h.els.get('guideModal').hidden, false, 'showGuide 后应显示');
  assert.strictEqual(h.UI.guideVisible, true, 'guideVisible 标记应为 true');
  const body = h.els.get('guideBody').innerHTML;
  assert.ok(body.includes('控制方向'), '指引内容应包含操作说明');
  assert.ok(body.includes('生命'), '指引内容应包含生命说明');
  assert.ok(body.includes('连击'), '指引内容应包含连击说明');
  assert.ok(body.includes('升级卡'), '指引内容应包含升级卡说明');
  assert.ok(body.includes('Boss 蛇'), '指引内容应包含 Boss 说明');
});

test('21.3 调用 UI.hideGuide 隐藏弹窗', () => {
  const h = H.createHarness();
  h.UI.showGuide();
  h.UI.hideGuide();
  assert.strictEqual(h.els.get('guideModal').hidden, true, 'hideGuide 后应隐藏');
  assert.strictEqual(h.UI.guideVisible, false, 'guideVisible 标记应为 false');
});

test('21.4 开始屏的玩法指引按钮可打开弹窗', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const guideBtn = h.els.get('ovGuide');
  assert.ok(guideBtn, '开始屏应存在玩法指引按钮');
  guideBtn.fire('click', CLICK);
  assert.strictEqual(h.els.get('guideModal').hidden, false, '点击按钮后弹窗应显示');
});

test('21.5 弹窗显示时按 Esc 会关闭', () => {
  const h = H.createHarness();
  h.UI.showGuide();
  h.key('Escape', 'Escape');
  assert.strictEqual(h.els.get('guideModal').hidden, true, 'Esc 后弹窗应关闭');
});

test('21.6 弹窗显示时按空格不会误开始游戏，而是关闭弹窗', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  h.UI.showGuide();
  h.key(' ', 'Space');
  assert.strictEqual(h.els.get('guideModal').hidden, true, '空格后弹窗应关闭');
  assert.strictEqual(h.Game.state, h.STATE.READY, '游戏不应进入 playing');
});

test('21.7 开始屏不再显示长段玩法说明（已移入弹窗）', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(!html.includes('撞毁只扣'), '开始屏不应再出现长说明');
  assert.ok(!html.includes('升级卡</b> 中选一张'), '开始屏不应出现具体玩法细节');
  assert.ok(html.includes('开始游戏'), '但开始按钮仍在');
});

test('21.8 App.showStart 不会在没有 sessionStorage 时崩溃', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.LEADERBOARD;
  h.UI.syncOverlay();
  assert.doesNotThrow(() => h.App.showStart(), 'showStart 在沙箱无 sessionStorage 时不应抛异常');
});
