/**
 * 运行：cd tests && node --test
 *
 * 10 - 排行榜（存储 / 展示 / 改名 / 清榜 / 状态机耦合）
 * 覆盖：
 *   - localStorage 键 snake-leaderboard，最多 10 条，[{name,score,date,duration}]
 *   - 同名同分视为同记录（替换并保留最新时间）
 *   - 分数降序排序 + Top10 截断
 *   - 结束屏显示「你的名次：#X / 共 Y 条」与改名输入框（默认 Ply，≤3 字符）
 *   - 开始屏 Top10 列表（空榜「暂无记录」）+ 清空按钮（5 秒二次确认倒计时）
 *   - 暂停屏不含排行榜
 *   - 脏数据 / 隐私模式 / 写入被拒绝 兜底不崩溃
 *
 * 说明：harness 未导出 Leaderboard 模块本身，因此全部通过「可观察行为」断言
 *      （localStorage、面板 innerHTML、UI.lbClearArmed 状态），与脚手架哲学一致。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

/* ---------- 测试辅助 ---------- */

/** 强制一局以指定分数快速撞墙结束，走真实 App.endGame -> commitScore 路径 */
function dieWithScore(h, score) {
  const g = h.Game;
  h.App.start();                 // READY / GAMEOVER -> PLAYING（全新一局）
  g.score = score;
  g.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  g.prevSnake = g.snake.map((c) => ({ x: c.x, y: c.y }));
  g.dir = h.DIR.left;
  g.dirQueue = [];
  h.pumpFrames(24);              // 累计 >400ms(慢速 interval≈235ms)，确保推进 tick 撞墙
  return g.state === h.STATE.GAMEOVER;
}

/** 结束屏改名：设置输入框值并点击「保存」 */
function rename(h, name) {
  const input = h.els.get('lbName');
  input.value = name;
  h.els.get('lbSave').fire('click', { stopPropagation() {}, preventDefault() {} });
}

/** 读取 localStorage 中的排行榜数组（空则返回 []） */
function readLb(h) {
  const raw = h.storageMap().get('snake-leaderboard');
  return raw ? JSON.parse(raw) : [];
}

const CLICK = { stopPropagation() {}, preventDefault() {} };

/* ================================================================== *
 * 1. 展示：三屏差异
 * ================================================================== */
test('10.1 开始屏空榜：显示「排行榜 TOP 10」「暂无记录」和清空按钮', () => {
  const h = H.createHarness();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('排行榜 TOP 10'), '应显示榜单标题');
  assert.ok(html.includes('暂无记录'), '空榜应显示「暂无记录」');
  assert.ok(html.includes('id="lbClear"'), '应有清空按钮');
  assert.strictEqual(h.UI.lbClearArmed, false, '未点击时不应处于确认态');
});

test('10.2 结束屏：提交成绩后显示「你的名次」与改名输入框', () => {
  const h = H.createHarness();
  assert.ok(dieWithScore(h, 80), '应进入 gameover');
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('你的名次'), '应显示名次提示');
  assert.ok(html.includes('id="lbName"'), '应有改名输入框');
  assert.ok(html.includes('id="lbEdit"'), '应有「改名」按钮');
  assert.ok(html.includes('共'), '应显示总条数');
});

test('10.3 暂停屏：不含任何排行榜元素', () => {
  const h = H.createHarness();
  h.App.start();
  h.App.pause();
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('已暂停'), '应显示暂停');
  assert.ok(!html.includes('排行榜'), '暂停屏不应含排行榜标题');
  assert.ok(!html.includes('lbClear'), '暂停屏不应含清空按钮');
});

/* ================================================================== *
 * 2. 存储与去重
 * ================================================================== */
test('10.4 一局结束后成绩写入 snake-leaderboard（默认名 Ply）', () => {
  const h = H.createHarness();
  dieWithScore(h, 70);
  const lb = readLb(h);
  assert.strictEqual(lb.length, 1, '应有 1 条记录');
  assert.strictEqual(lb[0].name, 'Ply');
  assert.strictEqual(lb[0].score, 70);
  assert.ok(typeof lb[0].date === 'string' && lb[0].date.length >= 10, '应有 ISO 日期');
  assert.ok(typeof lb[0].duration === 'number' && lb[0].duration >= 0, '应有非负时长');
});

test('10.5 同名同分视为同记录：再玩一局同分只保留 1 条且时间更新', () => {
  const h = H.createHarness();
  dieWithScore(h, 40);
  const first = readLb(h)[0].date;
  dieWithScore(h, 40);
  const lb = readLb(h);
  assert.strictEqual(lb.length, 1, '同名同分应去重为 1 条');
  assert.ok(lb[0].date >= first, '应保留最新时间');
});

test('10.6 多条记录按分数降序排列', () => {
  const h = H.createHarness();
  dieWithScore(h, 10);
  dieWithScore(h, 50);
  dieWithScore(h, 30);
  const lb = readLb(h);
  assert.deepStrictEqual(lb.map((e) => e.score), [50, 30, 10], '应按分数降序');
});

test('10.7 超过 10 条时只保留分数最高的前 10 条（Top10 截断）', () => {
  const h = H.createHarness();
  for (let i = 1; i <= 15; i++) dieWithScore(h, i * 5); // 5..75
  const lb = readLb(h);
  assert.strictEqual(lb.length, 10, '最多保留 10 条');
  assert.deepStrictEqual(
    lb.map((e) => e.score),
    [75, 70, 65, 60, 55, 50, 45, 40, 35, 30],
    '保留分数最高的 10 条'
  );
  // 开始屏列表也应只渲染 10 行
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  const html = h.els.get('panel').innerHTML;
  const cnt = (html.match(/class="lb-ranknum"/g) || []).length;
  assert.strictEqual(cnt, 10, '开始屏只渲染 10 行');
});

test('10.8 结束屏名次与总条数正确（高分在前）', () => {
  const h = H.createHarness();
  dieWithScore(h, 50);
  dieWithScore(h, 30); // 第二次死的 lastRecord=30，名次应为 #2 / 共 2 条
  const html = h.els.get('panel').innerHTML;
  assert.ok(html.includes('你的名次'), '应显示名次提示');
  assert.ok(html.includes('lb-rank">#2'), '30 分在 50 分之后的名次应为 #2');
  assert.ok(html.includes('共 2 条'), '总条数应为 2');
});

test('10.24 同名不同分视为不同记录，均保留', () => {
  const h = H.createHarness();
  dieWithScore(h, 20); // Ply,20
  rename(h, 'AB');     // -> AB,20
  dieWithScore(h, 35); // Ply,35
  const lb = readLb(h);
  assert.strictEqual(lb.length, 2, '不同分应为 2 条');
  assert.ok(lb.some((e) => e.name === 'AB' && e.score === 20), 'AB/20 应保留');
  assert.ok(lb.some((e) => e.name === 'Ply' && e.score === 35), 'Ply/35 应保留');
});

/* ================================================================== *
 * 3. 改名
 * ================================================================== */
test('10.9 结束屏改名（保存按钮）写入新名字', () => {
  const h = H.createHarness();
  dieWithScore(h, 60);
  rename(h, 'AB');
  const lb = readLb(h);
  assert.strictEqual(lb.length, 1, '改名不应新增记录');
  assert.strictEqual(lb[0].name, 'AB', '名字应更新为 AB');
  assert.strictEqual(lb[0].score, 60, '成绩不变');
});

test('10.10 结束屏按 Enter 键也能保存改名', () => {
  const h = H.createHarness();
  dieWithScore(h, 60);
  const input = h.els.get('lbName');
  input.value = 'XY';
  input.fire('keydown', { key: 'Enter', code: 'Enter', preventDefault() {} });
  assert.strictEqual(readLb(h)[0].name, 'XY', 'Enter 应触发保存');
});

test('10.11 名字超过 3 字符自动截断为 3', () => {
  const h = H.createHarness();
  dieWithScore(h, 60);
  rename(h, 'ABCD');
  assert.strictEqual(readLb(h)[0].name, 'ABC', '名字应截断到 3 字符');
});

test('10.22 改名时首尾空格被裁剪', () => {
  const h = H.createHarness();
  dieWithScore(h, 60);
  rename(h, '  QZ  ');
  assert.strictEqual(readLb(h)[0].name, 'QZ', '首尾空格应被裁剪');
});

test('10.23 改为空名时回退为默认名 Ply', () => {
  const h = H.createHarness();
  dieWithScore(h, 60);
  rename(h, '   ');
  assert.strictEqual(readLb(h)[0].name, 'Ply', '空名应回退为 Ply');
});

/* ================================================================== *
 * 4. 清榜（5 秒二次确认倒计时）
 * ================================================================== */
test('10.12 清空按钮首次点击进入二次确认，暂不清除', () => {
  const h = H.createHarness();
  dieWithScore(h, 55);
  h.Game.state = h.STATE.READY; // 清空按钮只在开始屏，切过去
  h.UI.syncOverlay();
  assert.strictEqual(readLb(h).length, 1);
  h.els.get('lbClear').fire('click', CLICK);
  assert.strictEqual(h.UI.lbClearArmed, true, '应进入确认态');
  assert.strictEqual(readLb(h).length, 1, '确认前应尚未清空');
});

test('10.13 清空按钮二次点击真正清空榜单', () => {
  const h = H.createHarness();
  dieWithScore(h, 55);
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  h.els.get('lbClear').fire('click', CLICK);
  h.els.get('lbClear').fire('click', CLICK);
  assert.strictEqual(h.UI.lbClearArmed, false, '清空后应解除确认态');
  assert.strictEqual(readLb(h).length, 0, '榜单应被清空');
  assert.strictEqual(h.storageMap().get('snake-leaderboard'), '[]', 'localStorage 应写入空数组');
});

test('10.14 清空未在 5 秒内二次确认则自动取消，不清除', () => {
  const h = H.createHarness();
  dieWithScore(h, 55);
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  h.els.get('lbClear').fire('click', CLICK);
  h.flushTimers(); // 触发 5 秒自动取消
  assert.strictEqual(h.UI.lbClearArmed, false, '超时后应自动取消');
  assert.strictEqual(readLb(h).length, 1, '自动取消不应清除记录');
});

/* ================================================================== *
 * 5. 脏数据兜底
 * ================================================================== */
test('10.15 排行榜脏数据（非法 JSON）降级为空榜，不崩溃', () => {
  assert.doesNotThrow(() => {
    const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': '{bad json' } });
    h.Game.state = h.STATE.READY;
    h.UI.syncOverlay();
    assert.ok(h.els.get('panel').innerHTML.includes('暂无记录'), '脏数据应显示空榜');
  });
});

test('10.16 排行榜存储为非数组时降级为空榜', () => {
  const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': '123' } });
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('暂无记录'), '非数组应显示空榜');
});

test('10.17 加载时名字超过 3 字符被截断', () => {
  const seed = JSON.stringify([{ name: 'ABCD', score: 10, date: '2024-01-01T00:00:00.000Z', duration: 3 }]);
  const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': seed } });
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('>ABC<'), '名字应截断为 ABC');
});

test('10.18 加载时时长被取整', () => {
  const seed = JSON.stringify([{ name: 'AB', score: 10, date: '2024-01-01T00:00:00.000Z', duration: 3.7 }]);
  const h = H.createHarness({ storage: 'ok', storageSeed: { 'snake-leaderboard': seed } });
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('3s'), '时长应取整为 3s');
});

/* ================================================================== *
 * 6. 隐私模式 / 写入被拒绝
 * ================================================================== */
test('10.19 隐私模式（localStorage 不存在）下游戏与排行榜流程不崩溃', () => {
  assert.doesNotThrow(() => {
    const h = H.createHarness({ storage: 'undefined' });
    assert.ok(dieWithScore(h, 40), '应正常进入 gameover');
    h.Game.state = h.STATE.READY;
    h.UI.syncOverlay(); // 不应抛异常
  });
});

test('10.20 写入被拒绝（throw）时排行榜静默降级，无 console 输出', () => {
  const h = H.createHarness({ storage: 'throw' });
  assert.doesNotThrow(() => dieWithScore(h, 40));
  assert.deepStrictEqual(h.consoleLog, [], '不应有任何 console 输出');
});

/* ================================================================== *
 * 7. 状态机耦合
 * ================================================================== */
test('10.21 一局结束后重开，开始屏仍显示该记录', () => {
  const h = H.createHarness();
  dieWithScore(h, 90);
  h.App.restart();
  h.Game.state = h.STATE.READY;
  h.UI.syncOverlay();
  assert.ok(h.els.get('panel').innerHTML.includes('lb-ranknum'), '重开后开始屏应仍显示记录');
});
