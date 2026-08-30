/**
 * 运行：cd tests && node --test
 *
 * 18 - 排行榜独立按钮与面板（H 轮社交分享·前置）
 * 覆盖：
 *   - 开始屏新增「排行榜」按钮，且不再内嵌排行榜块
 *   - 点击按钮进入独立 LEADERBOARD 面板（含列表与返回按钮）
 *   - 点击「返回」回到开始屏
 *   - LEADERBOARD 态不误开始（空格/Enter 走 primaryAction 无效）
 *   - LEADERBOARD 态 Esc / showStart 返回 READY
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('18.1 开始屏含「排行榜」按钮，且不再内嵌排行榜块', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('id="ovLb"'), '开始屏应有排行榜按钮 ovLb');
  assert.ok(html.includes('🏆 排行榜'), '排行榜按钮文案应显示');
  assert.ok(!html.includes('class="leaderboard"'), '开始屏不应再内嵌排行榜块');
});

test('18.2 点击「排行榜」按钮进入独立面板', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const lbBtn = h.els.get('ovLb');
  assert.ok(lbBtn, '应找到 ovLb 按钮');
  lbBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(h.Game.state, h.STATE.LEADERBOARD, '点排行榜应进入 LEADERBOARD 态');
  assert.ok(h.els.get('panel').innerHTML.includes('lb-list'), 'LEADERBOARD 面板应含排行榜列表');
  assert.ok(h.els.get('ovBack'), 'LEADERBOARD 面板应有返回按钮');
});

test('18.3 点击「返回」回到开始屏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.LEADERBOARD;
  h.UI.syncOverlay();
  const backBtn = h.els.get('ovBack');
  assert.ok(backBtn, 'LEADERBOARD 面板应有 ovBack 按钮');
  backBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(h.Game.state, h.STATE.READY, '点返回应回 READY');
});

test('18.4 LEADERBOARD 态 primaryAction 不开始游戏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.LEADERBOARD;
  h.UI.syncOverlay();
  h.App.primaryAction();
  assert.strictEqual(h.Game.state, h.STATE.LEADERBOARD, 'LEADERBOARD 态空格/Enter 不应开始');
});

test('18.5 LEADERBOARD 态 Esc 返回开始屏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.LEADERBOARD;
  h.UI.syncOverlay();
  if (h.Input && h.Input.onKeyDown) {
    h.Input.onKeyDown({ key: 'Escape', code: 'Escape', preventDefault() {} });
  } else {
    h.App.showStart();
  }
  assert.strictEqual(h.Game.state, h.STATE.READY, 'Esc 应回到开始屏');
});
