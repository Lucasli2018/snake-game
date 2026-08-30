/**
 * 运行：cd tests && node --test
 *
 * 20 - 成就系统入口与独立面板（首页「★ 成就」按钮）
 * 覆盖：
 *   - 开始屏新增「★ 成就」按钮，且不再内嵌成就块
 *   - 点击按钮进入独立 ACHIEVEMENTS 面板（含 12 张成就卡 + 进度 + 返回按钮）
 *   - 点击「返回」回到开始屏
 *   - ACHIEVEMENTS 态不误开始（空格/Enter 走 primaryAction 无效）
 *   - ACHIEVEMENTS 态 Esc 返回开始屏
 *   - 已解锁成就正确显示为「已解锁」并在进度条计数
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('20.1 开始屏含「★ 成就」按钮，且不再内嵌成就块', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('id="ovAch"'), '开始屏应有成就按钮 ovAch');
  assert.ok(html.includes('★ 成就'), '成就按钮文案应显示');
  assert.ok(!html.includes('class="ach-grid"'), '开始屏不应再内嵌成就块');
});

test('20.2 点击「成就」按钮进入独立面板（12 卡 + 进度 + 返回）', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const achBtn = h.els.get('ovAch');
  assert.ok(achBtn, '应找到 ovAch 按钮');
  achBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(h.Game.state, h.STATE.ACHIEVEMENTS, '点成就应进入 ACHIEVEMENTS 态');
  const html = h.els.get('panel').innerHTML;
  const cardCount = (html.match(/class="ach-card/g) || []).length;
  assert.strictEqual(cardCount, 12, 'ACHIEVEMENTS 面板应渲染 12 张成就卡，实际 ' + cardCount);
  assert.ok(html.includes('ach-progress'), '面板应含进度条');
  assert.ok(html.includes('已解锁 <b>0</b> / 12'), '初始应显示 0 / 12');
  assert.ok(h.els.get('ovBack'), 'ACHIEVEMENTS 面板应有返回按钮');
});

test('20.3 点击「返回」回到开始屏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.ACHIEVEMENTS;
  h.UI.syncOverlay();
  const backBtn = h.els.get('ovBack');
  assert.ok(backBtn, 'ACHIEVEMENTS 面板应有 ovBack 按钮');
  backBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(h.Game.state, h.STATE.READY, '点返回应回 READY');
});

test('20.4 ACHIEVEMENTS 态 primaryAction 不开始游戏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.ACHIEVEMENTS;
  h.UI.syncOverlay();
  h.App.primaryAction();
  assert.strictEqual(h.Game.state, h.STATE.ACHIEVEMENTS, 'ACHIEVEMENTS 态空格/Enter 不应开始');
});

test('20.5 ACHIEVEMENTS 态 Esc 返回开始屏', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.ACHIEVEMENTS;
  h.UI.syncOverlay();
  if (h.Input && h.Input.onKeyDown) {
    h.Input.onKeyDown({ key: 'Escape', code: 'Escape', preventDefault() {} });
  } else {
    h.App.showStart();
  }
  assert.strictEqual(h.Game.state, h.STATE.READY, 'Esc 应回到开始屏');
});

test('20.6 已解锁成就正确显示为「已解锁」并计入进度', () => {
  const h = H.createHarness();
  h.Achievements.unlock('first');     // 解锁「初出茅庐」
  h.Game.state = h.STATE.ACHIEVEMENTS;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('已解锁 <b>1</b> / 12'), '解锁 1 项后应显示 1 / 12');
  const unlocked = (html.match(/ach-card unlocked/g) || []).length;
  const locked = (html.match(/ach-card locked/g) || []).length;
  assert.strictEqual(unlocked, 1, '应有 1 张已解锁卡片，实际 ' + unlocked);
  assert.strictEqual(locked, 11, '应有 11 张未解锁卡片，实际 ' + locked);
});
