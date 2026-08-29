/**
 * 运行：cd tests && node --test
 *
 * 12 - B 轮体验闭环
 * 覆盖：
 *   - 键盘方向键：keydown 在 READY 开始+入队、PLAYING 入队、180° 反向过滤
 *   - 轻点暂停：移动端 tap 在 PLAYING 暂停、READY 开始、PAUSED 继续
 *   - 浅/深主题切换：toggle data-theme + localStorage 持久化 + 图标切换，且不干扰游戏
 * （暂停特效冻结由 08.18 专项覆盖；虚拟方向键 dpad 已移除，移动端用滑动屏幕转向）
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('12.1 键盘方向键：READY 开始+入队、PLAYING 合法方向入队、180° 反向过滤', () => {
  const h = H.createHarness();
  assert.strictEqual(h.Game.state, h.STATE.READY, '初始应为准备态');

  // READY 时按上方向键：开始游戏 + 入队 up
  h.key('ArrowUp', 'ArrowUp');
  assert.strictEqual(h.Game.state, h.STATE.PLAYING, 'READY 按方向键应开始游戏');
  assert.strictEqual(h.Game.dirQueue.length, 1, '开始时应入队一个方向');
  assert.deepStrictEqual(h.Game.dirQueue[0], h.DIR.up, 'ArrowUp 应入队 up');

  // 找与当前 dir 不同轴的合法方向键（WASD），验证 PLAYING 态入队
  const cur = h.Game.dir;
  const byKey = {
    'w': h.DIR.up, 'W': h.DIR.up,
    's': h.DIR.down, 'S': h.DIR.down,
    'a': h.DIR.left, 'A': h.DIR.left,
    'd': h.DIR.right, 'D': h.DIR.right,
    'ArrowLeft': h.DIR.left, 'ArrowRight': h.DIR.right
  };
  let validKey = null;
  let validDir = null;
  for (const k in byKey) {
    const d = byKey[k];
    const sameAxis = (d.x !== 0 && cur.x !== 0) || (d.y !== 0 && cur.y !== 0);
    if (!sameAxis) { validKey = k; validDir = d; break; }
  }
  assert.ok(validKey && validDir, '应能找到与当前 dir 垂直的有效方向键');

  h.Game.dirQueue.length = 0;
  h.key(validKey);
  assert.strictEqual(h.Game.dirQueue.length, 1, 'PLAYING 态合法方向键应入队');
  assert.deepStrictEqual(h.Game.dirQueue[0], validDir, '入队方向正确');

  // 已入队方向的反向键应被 180° 过滤忽略（避免穿身）
  const before = h.Game.dirQueue.length;
  h.key(validKey === 'w' ? 's' : (validKey === 'a' ? 'd' : validKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowUp'));
  // 反向要看入队的方向是谁；上面入队的是 validDir（与初始 up 垂直的某个轴方向），反向键入队该方向的反向
  // 为简单：直接按刚刚入队的 validDir 的反向键，验证队列不变（已有反向过滤）
  // 这里再取一遍反向键名（基于 validDir）：
  const oppKey = (() => {
    for (const k in byKey) {
      const d = byKey[k];
      if (d.x === -validDir.x && d.y === -validDir.y) return k;
    }
    return null;
  })();
  assert.ok(oppKey, '应能找到已入队方向的反向键');
  const beforeOpp = h.Game.dirQueue.length;
  h.key(oppKey);
  assert.strictEqual(h.Game.dirQueue.length, beforeOpp, '已入队方向的反向键应被过滤，不入队');
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
