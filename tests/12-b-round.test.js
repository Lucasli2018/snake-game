/**
 * 运行：cd tests && node --test
 *
 * 12 - B 轮体验闭环
 * 覆盖：
 *   - 虚拟方向键（dpad）：pointerdown 即时转向入队
 *   - 轻点暂停：移动端 tap 在 PLAYING 暂停、READY 开始、PAUSED 继续
 *   - 浅/深主题切换：toggle data-theme + localStorage 持久化 + 图标切换，且不干扰游戏
 * （暂停特效冻结由 08.18 专项覆盖）
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('12.1 虚拟方向键：pointerdown 触发转向（含反向过滤）', () => {
  const h = H.createHarness();
  assert.strictEqual(h.Game.state, h.STATE.READY, '初始应为准备态');

  // READY 时点方向键应开始游戏并入队
  h.els.get('dbtn-up').fire('pointerdown', { preventDefault() {} });
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'READY 点方向键应开始游戏');
  assert.strictEqual(h.Game.dirQueue.length, 1, '开始时应入队一个方向');
  assert.deepStrictEqual(h.Game.dirQueue[0], h.DIR.up, '上键入队 up');

  // 基于当前 dir 找一个不同轴（合法垂直转向）的方向键名，验证 PLAYING 态也入队
  const cur = h.Game.dir;
  const byName = {
    'dbtn-up': h.DIR.up, 'dbtn-down': h.DIR.down,
    'dbtn-left': h.DIR.left, 'dbtn-right': h.DIR.right
  };
  let validName = null;
  for (const name in byName) {
    const d = byName[name];
    // 与当前 dir 不同轴（非同向、非反向）即合法新方向
    const sameAxis = (d.x !== 0 && cur.x !== 0) || (d.y !== 0 && cur.y !== 0);
    if (!sameAxis) { validName = name; break; }
  }
  assert.ok(validName, '应能找到与当前 dir 垂直的有效方向键');

  h.Game.dirQueue.length = 0;
  h.els.get(validName).fire('pointerdown', { preventDefault() {} });
  assert.strictEqual(h.Game.dirQueue.length, 1, 'PLAYING 态点合法方向键应入队');
  assert.deepStrictEqual(h.Game.dirQueue[0], byName[validName], '入队方向正确');

  // 已入队方向的反向键应被 180° 过滤忽略（避免穿身）
  const validDir = byName[validName];
  let oppName = null;
  for (const name in byName) {
    const d = byName[name];
    if (d.x === -validDir.x && d.y === -validDir.y) { oppName = name; break; }
  }
  assert.ok(oppName, '应能找到已入队方向的反向键');
  const before = h.Game.dirQueue.length;
  h.els.get(oppName).fire('pointerdown', { preventDefault() {} });
  assert.strictEqual(h.Game.dirQueue.length, before, '已入队方向的反向键应被过滤，不入队');
});

test('12.2 主题切换：浅/深 toggle + 持久化 + 图标切换', () => {
  const h = H.createHarness();
  assert.notStrictEqual(h.document.documentElement.dataset.theme, 'dark', '默认应为浅色（无 data-theme 或 light）');

  const tb = h.els.get('themeBtn');
  tb.fire('click', { stopPropagation() {} });
  assert.strictEqual(h.document.documentElement.dataset.theme, 'dark', '点击后应切到深色');
  assert.strictEqual(h.Storage.get('snake-game.theme.v1'), 'dark', '深色应持久化到 localStorage');

  // 深色时显示太阳图标、隐藏月亮图标
  assert.strictEqual(h.els.get('moonIcon').style.display, 'none', '深色时月亮图标应隐藏');
  assert.notStrictEqual(h.els.get('sunIcon').style.display, 'none', '深色时太阳图标应显示');

  tb.fire('click', { stopPropagation() {} });
  assert.notStrictEqual(h.document.documentElement.dataset.theme, 'dark', '再次点击应切回浅色');
  assert.strictEqual(h.Storage.get('snake-game.theme.v1'), 'light', '浅色应持久化到 localStorage');
  assert.notStrictEqual(h.els.get('moonIcon').style.display, 'none', '浅色时月亮图标应显示');
});

test('12.3 主题按钮不干扰游戏进行', () => {
  const h = H.createHarness();
  h.startPlaying();
  h.els.get('themeBtn').fire('click', { stopPropagation() {} });
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, '切换主题不应改变游戏状态');
  assert.doesNotThrow(() => h.pumpFrames(30), '切主题后主循环应继续可玩');
});

test('12.4 轻点暂停：PLAYING 轻点暂停、PAUSED 轻点遮罩继续、READY 轻点开始', () => {
  const h = H.createHarness();

  // READY 轻点开始
  assert.strictEqual(h.Game.state, h.STATE.READY);
  h.tap();
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'READY 轻点应开始');

  // PLAYING 轻点暂停
  h.tap();
  assert.strictEqual(h.Game.state, h.STATE.PAUSED, 'PLAYING 轻点应暂停');
  assert.strictEqual(h.els.get('overlay').hidden, false, '暂停后遮罩应显示');

  // PAUSED 轻点遮罩（overlay click）继续游戏
  h.els.get('overlay').fire('click', {});
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, '暂停态轻点遮罩应继续');
});
