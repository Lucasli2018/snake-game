/**
 * 运行：cd tests && node --test
 *
 * 07 - 静态检查（零外部依赖 / 无残留调试代码 / 语法与未定义变量）
 * 覆盖：
 *   - 全文扫描：没有任何外部资源引用（http(s)://、//cdn、外链 src/href、@import、url()）
 *   - 没有残留 console.* / debugger / alert
 *   - 语法检查（node 的解析器）
 *   - 真实执行 boot() 与全状态渲染，捕获未定义变量 / ReferenceError
 *   - HTML 结构完整性：所有 getElementById 用到的 id 都在 DOM 里存在
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const H = require('./harness');

const HTML = H.HTML_TEXT;
const SRC = H.SCRIPT_SRC;

/* ================================================================== *
 * 1. 零外部依赖
 * ================================================================== */
test('07.1 全文不含任何 http:// 或 https:// 引用', () => {
  const hits = [];
  const re = /https?:\/\/[^\s"'`)]*/gi;
  let m;
  while ((m = re.exec(HTML)) !== null) hits.push(m[0]);
  assert.deepStrictEqual(hits, [], `发现外部 URL 引用：${JSON.stringify(hits)}`);
});

test('07.2 不含协议相对外链（//cdn... 之类）', () => {
  // 排除 JS 里的整除注释之类误报：只查引号内或 url() 里的 //xxx
  const re = /["'(]\s*\/\/[a-z0-9.-]+\.[a-z]{2,}/gi;
  const hits = HTML.match(re) || [];
  assert.deepStrictEqual(hits, [], `发现协议相对外链：${JSON.stringify(hits)}`);
});

test('07.3 没有带外链的 src= / href=（src="..." 只能引用 data:、空、锚点或相对路径）', () => {
  const attrs = HTML.match(/\b(?:src|href)\s*=\s*["'][^"']*["']/gi) || [];
  // 允许：空值、data: URI、锚点 (#...)、相对路径（如 index.html、./foo、../bar）
  // 拒绝：http(s):// 与 // 协议相对外链（CDN/远程资源）
  const external = attrs.filter((a) => {
    const m = a.match(/=\s*["']([^"']*)["']/);
    if (!m) return false;
    const v = m[1];
    if (v === '' || /^data:/i.test(v) || v.startsWith('#')) return false;
    return /^https?:\/\//i.test(v) || v.startsWith('//');
  });
  assert.deepStrictEqual(external, [], `发现外部资源属性：${JSON.stringify(external)}`);
});

test('07.4 CSS 里没有 @import，也没有 url( 外链', () => {
  assert.ok(!/@import/i.test(HTML), '发现 @import');
  // 注意：大小写不敏感会误伤 Canvas 的 toDataURL( 调用，用负向后行断言排除（它不是 CSS 外链）
  const urls = HTML.match(/(?<!toData)url\s*\([^)]*\)/gi) || [];
  const external = urls.filter((u) => !/data:/i.test(u) && !/gradient/i.test(u));
  assert.deepStrictEqual(external, [], `发现 CSS url() 外链：${JSON.stringify(external)}`);
});

test('07.5 没有外链字体（@font-face / fonts.googleapis 等）', () => {
  assert.ok(!/@font-face/i.test(HTML), '发现 @font-face');
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/i.test(HTML), '发现 Google Fonts 外链');
  // 字体族必须是系统字体栈
  assert.ok(/-apple-system|BlinkMacSystemFont/i.test(HTML), '应使用系统字体栈');
});

test('07.6 不含 <link> 外链、<img> 外链、<iframe>、外部 <script src>', () => {
  assert.ok(!/<link\b/i.test(HTML), '发现 <link> 标签');
  assert.ok(!/<img\b/i.test(HTML), '发现 <img> 标签');
  assert.ok(!/<iframe\b/i.test(HTML), '发现 <iframe>');
  assert.ok(!/<script[^>]+src=/i.test(HTML), '发现带 src 的 <script>');
  assert.ok(!/integrity\s*=/i.test(HTML), '发现 SRI 属性（说明引了外部资源）');
});

test('07.7 内联 SVG 是唯一的图形资源，且无外部 xlink:href', () => {
  const svgCount = (HTML.match(/<svg\b/gi) || []).length;
  assert.ok(svgCount >= 2, `内联 SVG 数量异常：${svgCount}`);
  assert.ok(!/xlink:href\s*=\s*["']http/i.test(HTML), 'SVG 引用了外部资源');
});

/* ================================================================== *
 * 2. 无残留调试代码
 * ================================================================== */
test('07.8 没有残留 console.* 调用', () => {
  const hits = SRC.match(/console\s*\.\s*(log|info|warn|error|debug|trace|dir|table)\b/gi) || [];
  assert.deepStrictEqual(hits, [], `发现残留 console 调用：${JSON.stringify(hits)}`);
});

test('07.9 没有 debugger / alert / prompt / confirm', () => {
  assert.ok(!/\bdebugger\b/.test(SRC), '发现 debugger 语句');
  assert.ok(!/\balert\s*\(/.test(SRC), '发现 alert');
  assert.ok(!/\bprompt\s*\(/.test(SRC), '发现 prompt');
  assert.ok(!/\bconfirm\s*\(/.test(SRC), '发现 confirm');
});

test('07.10 没有 TODO / FIXME / 打桩占位', () => {
  const hits = SRC.match(/\b(TODO|FIXME|XXX|HACK)\b/g) || [];
  assert.deepStrictEqual(hits, [], `发现未完成标记：${JSON.stringify(hits)}`);
});

/* ================================================================== *
 * 3. 语法 / 未定义变量
 * ================================================================== */
test('07.11 内联脚本能通过 node 的解析器（语法合法）', () => {
  // 1) vm 解析
  assert.doesNotThrow(() => new vm.Script(SRC, { filename: 'inline.js' }), '内联脚本存在语法错误');

  // 2) 用真实的 node --check 再验一次
  const tmp = path.join(os.tmpdir(), `snake-inline-${process.pid}-${Date.now()}.js`);
  try {
    fs.writeFileSync(tmp, SRC, 'utf8');
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    assert.fail('node --check 失败：\n' + (e.stderr ? e.stderr.toString() : e.message));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* 忽略清理失败 */ }
  }
});

test('07.12 脚本运行在严格模式下（use strict 生效，未定义变量会直接抛错）', () => {
  assert.ok(/'use strict'|"use strict"/.test(SRC.slice(0, 400)), 'IIFE 顶部应有 use strict');
});

test('07.13 代码里没有明显的拼写型未定义变量（抽查所有已声明标识符）', () => {
  // 收集所有 var/let/const/function 声明与形参之外的裸标识符过于激进，
  // 这里改为：真实执行 boot() + 各个状态分支，任何 ReferenceError 都会冒出来。
  const h = H.createHarness();
  assert.strictEqual(h.Game.state, h.STATE.READY, 'boot() 未正常完成');
  h.startPlaying();
  h.pumpFrames(50);
  assert.deepStrictEqual(h.consoleLog, [], '运行期出现了 console 输出');
});

test('07.14 遍历所有 UI 状态渲染一遍，捕获未定义变量 / 渲染异常', () => {
  const h = H.createHarness();
  const states = [h.STATE.READY, h.STATE.PLAYING, h.STATE.PAUSED, h.STATE.GAMEOVER];

  for (const s of states) {
    h.Game.state = s;
    h.Game.deathReason = 'wall';
    h.Game.win = false;
    assert.doesNotThrow(() => h.UI.syncOverlay(), `${s} 状态 syncOverlay 抛异常`);
    assert.doesNotThrow(() => h.UI.updateHud(), `${s} 状态 updateHud 抛异常`);
    assert.doesNotThrow(() => h.Renderer.render(0.5), `${s} 状态 render 抛异常`);
  }

  // 通关态
  h.Game.state = h.STATE.GAMEOVER;
  h.Game.win = true;
  assert.doesNotThrow(() => h.UI.syncOverlay(), '通关态 syncOverlay 抛异常');
  assert.ok(h.els.get('panel').innerHTML.includes('通关'), '通关态面板文案缺失');
});

test('07.15 所有 getElementById 用到的 id 在 HTML 中确实存在', () => {
  const ids = new Set();
  const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(SRC)) !== null) ids.add(m[1]);

  for (const id of ids) {
    if (id === 'ovBtn') continue;              // 由 innerHTML 动态生成
    assert.ok(new RegExp(`id="${id}"`).test(HTML),
      `代码引用了 id="${id}"，但 HTML 里没有这个元素`);
  }
  assert.ok(ids.size >= 10, `只找到 ${ids.size} 个 id 引用，正则可能失效`);
});

test('07.16 事件监听器全部绑定成功（不是绑到 null 上）', () => {
  const h = H.createHarness();
  assert.ok((h.document._listeners['keydown'] || []).length > 0, 'keydown 未绑定');
  assert.ok((h.document._listeners['visibilitychange'] || []).length > 0, 'visibilitychange 未绑定');
  assert.ok((h.window._listeners['blur'] || []).length > 0, 'blur 未绑定');
  assert.ok((h.window._listeners['resize'] || []).length > 0, 'resize 未绑定');
  assert.ok((h.window._listeners['orientationchange'] || []).length > 0, 'orientationchange 未绑定');

  const stage = h.els.get('stage');
  assert.ok((stage._listeners['touchstart'] || []).length > 0, 'touchstart 未绑定');
  assert.ok((stage._listeners['touchmove'] || []).length > 0, 'touchmove 未绑定');
  assert.ok((stage._listeners['touchend'] || []).length > 0, 'touchend 未绑定');
});

/* ================================================================== *
 * 4. 产物特征
 * ================================================================== */
test('07.17 单文件、体积合理、HTML 结构完整', () => {
  const files = fs.readdirSync(path.resolve(__dirname, '..')).filter((f) => f !== 'tests');
  assert.ok(files.includes('index.html'), '缺少 index.html');

  const size = fs.statSync(path.resolve(__dirname, '..', 'index.html')).size;
  assert.ok(size > 10 * 1024 && size < 500 * 1024, `index.html 体积异常：${size} 字节`);

  assert.ok(/<!DOCTYPE html>/i.test(HTML), '缺少 DOCTYPE');
  assert.ok(/<html[^>]*lang=/i.test(HTML), '<html> 缺少 lang 属性');
  assert.ok(/<meta charset=/i.test(HTML), '缺少 charset 声明');
  assert.ok(/<meta name="viewport"/i.test(HTML), '缺少 viewport（移动端不可用）');
  assert.ok(/<\/html>\s*$/i.test(HTML.trim()), 'HTML 未正确闭合');
  assert.ok(/<title>/i.test(HTML), '缺少 <title>');
});

test('07.18 整个文档标签配平（<script> / <style> / <div> 等）', () => {
  const count = (re) => (HTML.match(re) || []).length;
  assert.strictEqual(count(/<script\b/gi), 1, '应只有 1 个 <script> 块');
  assert.strictEqual(count(/<style\b/gi), 1, '应只有 1 个 <style> 块');
  assert.strictEqual(count(/<div\b/gi), count(/<\/div>/gi), '<div> 未配平');
  assert.strictEqual(count(/<span\b/gi), count(/<\/span>/gi), '<span> 未配平');
  assert.strictEqual(count(/<svg\b/gi), count(/<\/svg>/gi), '<svg> 未配平');
  assert.strictEqual(count(/<canvas\b/gi), 1, '应只有 1 个 <canvas>');
});
