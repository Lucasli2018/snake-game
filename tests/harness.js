/**
 * 测试脚手架（Test Harness）
 * ============================================================================
 * 作用：把 index.html 里**内联的那一段真实游戏代码**原封不动地抽出来，
 *       放进 Node 的 vm 沙箱里，用一套最小的 DOM / Canvas2D / WebAudio /
 *       requestAnimationFrame / localStorage 替身把它真正跑起来。
 *
 * 为什么这么做：
 *   直接把「关键纯函数抄一份到测试文件」是假验证 —— 抄错一行就测了个寂寞。
 *   这里跑的是 index.html 里逐字逐句的代码，所以断言结果对源码才是有效的。
 *
 * 运行方式（见各 *.test.js 文件头）：
 *   cd tests && node --test
 * ============================================================================
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const HTML_TEXT = fs.readFileSync(HTML_PATH, 'utf8');

/* ------------------------------------------------------------------ *
 * 1. 抽取内联 <script>
 * ------------------------------------------------------------------ */
function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('index.html 中找不到内联 <script> 块');
  return m[1];
}

const SCRIPT_SRC = extractScript(HTML_TEXT);

/**
 * 在 IIFE 结尾注入一行导出，让我们能拿到内部的 Config / Game / App 等对象。
 * 注意：**除此之外不修改源码的任何一个字符**。
 */
function patchForExport(src) {
  const tail = '\n})();';
  const i = src.lastIndexOf(tail);
  if (i < 0) throw new Error('找不到 IIFE 结尾（\\n})();），无法注入导出');
  return (
    src.slice(0, i) +
    '\n  globalThis.__EXPORT__ = { Config: Config, DIR: DIR, STATE: STATE,' +
    ' Storage: Storage, Sfx: Sfx, Game: Game, Fx: Fx, Renderer: Renderer,' +
    ' UI: UI, Input: Input, App: App, roundRect: roundRect, getFontFamily: getFontFamily };' +
    '\n})();'
  );
}

/* ------------------------------------------------------------------ *
 * 2. Canvas 2D 上下文替身
 *    任何未显式实现的方法都当作 no-op；属性读写记录到 store。
 *    同时对 WebAudio / Canvas 的隐式契约做严格校验（NaN、指数 ramp 到 0 等）。
 * ------------------------------------------------------------------ */
function makeCtx2D(record) {
  const store = Object.create(null);
  const gradient = { addColorStop() {} };

  const handler = {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => gradient;
      }
      if (prop === 'createPattern') return () => null;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop in target) return target[prop];
      // 未知方法 -> no-op（自动兼容未来新增的绘制调用）
      return () => undefined;
    },
    set(target, prop, value) {
      if (typeof prop === 'string' && /Alpha|Width|Shadow|font|Style/.test(prop)) {
        if (typeof value === 'number' && !isFinite(value)) {
          throw new Error('Canvas 属性 ' + prop + ' 被赋值为非有限数：' + value);
        }
      }
      target[prop] = value;
      return true;
    }
  };
  return new Proxy(store, handler);
}

/* ------------------------------------------------------------------ *
 * 3. WebAudio 替身（用于验证 Sfx 代码路径不会抛异常 / 不会传 NaN）
 * ------------------------------------------------------------------ */
class FakeAudioParam {
  constructor(name) { this.value = 0; this.name = name; this.events = []; }
  _chk(v, t, who) {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(who + ': 值非法 ' + v);
    if (typeof t !== 'number' || !isFinite(t) || t < 0) throw new Error(who + ': 时间非法 ' + t);
    this.events.push({ v, t });
  }
  setValueAtTime(v, t) { this._chk(v, t, this.name + '.setValueAtTime'); return this; }
  linearRampToValueAtTime(v, t) { this._chk(v, t, this.name + '.linearRamp'); return this; }
  exponentialRampToValueAtTime(v, t) {
    // 浏览器规范：exponentialRamp 目标值为 0 会抛 RangeError
    if (v === 0) throw new RangeError(this.name + '.exponentialRampToValueAtTime(0) 会抛异常');
    this._chk(v, t, this.name + '.exponentialRamp');
    return this;
  }
}

class FakeAudioNode {
  constructor() {
    this.frequency = new FakeAudioParam('frequency');
    this.detune = new FakeAudioParam('detune');
    this.gain = new FakeAudioParam('gain');
    this.Q = new FakeAudioParam('Q');
    this.type = 'sine';
  }
  connect() { return this; }
  disconnect() {}
  start(t) { if (t !== undefined && (!isFinite(t) || t < 0)) throw new Error('start 时间非法 ' + t); }
  stop(t) { if (t !== undefined && (!isFinite(t) || t < 0)) throw new Error('stop 时间非法 ' + t); }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = new FakeAudioNode();
    this.nodesCreated = 0;
  }
  createOscillator() { this.nodesCreated++; return new FakeAudioNode(); }
  createGain() { this.nodesCreated++; return new FakeAudioNode(); }
  createBiquadFilter() { this.nodesCreated++; const n = new FakeAudioNode(); n.type = 'lowpass'; return n; }
  createBufferSource() { this.nodesCreated++; return new FakeAudioNode(); }
  createBuffer(ch, len, sr) {
    if (!(len > 0)) throw new Error('createBuffer 长度非法 ' + len);
    return { length: len, getChannelData: () => new Float32Array(len) };
  }
  resume() { return Promise.resolve(); }
}

/* ------------------------------------------------------------------ *
 * 4. DOM 替身
 * ------------------------------------------------------------------ */
const STATIC_IDS = [
  'scoreEl', 'bestEl', 'levelEl', 'tpsEl', 'speedFill',
  'overlay', 'panel', 'soundBtn', 'wave1', 'wave2', 'slash',
  'stage', 'game'
];

function makeElement(id, env) {
  const listeners = Object.create(null);
  const el = {
    id: id,
    tagName: id === 'game' ? 'CANVAS' : 'DIV',
    style: {},
    dataset: {},
    textContent: '',
    title: '',
    hidden: false,
    width: 0,
    height: 0,
    _html: '',
    _listeners: listeners,
    _ctx: null,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) {
        if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
        else if (on) this._set.add(c); else this._set.delete(c);
      }
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const a = listeners[type] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
    fire(type, ev) { (listeners[type] || []).forEach((f) => f(ev || { type: type })); },
    getBoundingClientRect() {
      const s = env.stageSize;
      return { x: 0, y: 0, top: 0, left: 0, width: s, height: s, right: s, bottom: s };
    },
    getContext(kind) {
      if (kind !== '2d') return null;
      if (!el._ctx) el._ctx = makeCtx2D(env.drawRecord);
      return el._ctx;
    },
    appendChild() {},
    removeChild() {},
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      el._html = String(v);
      // 源码会先写 panel.innerHTML 再 getElementById('ovBtn')，这里必须同步登记
      env.registerIdsFromHtml(el._html);
    }
  });
  return el;
}

/* ------------------------------------------------------------------ *
 * 5. 组装沙箱
 * ------------------------------------------------------------------ */
/**
 * @param {object} opts
 *   - stageSize  舞台边长（px），默认 600
 *   - storage    'ok' | 'throw' | 'undefined' | 'garbage'
 *   - dpr        devicePixelRatio
 *   - audio      true/false，是否提供 AudioContext
 */
function createHarness(opts) {
  opts = opts || {};
  const env = {
    stageSize: opts.stageSize === undefined ? 600 : opts.stageSize,
    drawRecord: { calls: 0 }
  };

  const registry = new Map();
  env.registerIdsFromHtml = function (html) {
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      // 关键：给 innerHTML 赋值会**重建整棵子树**，新 HTML 里的 id 对应的是全新的节点，
      // 旧节点连同其上绑定的事件监听器一起被丢弃。
      // 所以这里必须无条件覆盖 registry，而不能只在 id 不存在时才创建 ——
      // 否则同一个 ovBtn 对象被反复复用，syncOverlay() 每次都往它身上再挂一个 click 监听，
      // 点击一次就会触发 N 次 primaryAction()，与浏览器真实行为不符。
      // （id 缓存复用只适用于静态节点，不适用于 innerHTML 动态生成的节点）
      registry.set(m[1], makeElement(m[1], env));
    }
  };
  for (const id of STATIC_IDS) registry.set(id, makeElement(id, env));

  const docListeners = Object.create(null);
  const winListeners = Object.create(null);

  const document = {
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    _listeners: docListeners,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const a = docListeners[type] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    getElementById(id) { return registry.has(id) ? registry.get(id) : null; },
    createElement(tag) { return makeElement('dyn-' + tag, env); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  document.body = makeElement('body', env);

  // ---- 计时 ----
  const clock = { t: 0 };
  let rafQueue = [];
  let rafId = 1;
  const timers = [];
  let timerId = 1;

  function requestAnimationFrame(cb) { rafQueue.push(cb); return rafId++; }
  function cancelAnimationFrame() {}

  const performanceStub = { now: () => clock.t };

  // ---- localStorage ----
  function makeStorage(mode, seed) {
    if (mode === 'undefined') return undefined;
    const map = new Map(Object.entries(seed || {}));
    const st = {
      _map: map,
      getItem(k) {
        if (mode === 'throw') throw new DOMException('SecurityError: localStorage 被禁用');
        return map.has(k) ? map.get(k) : null;
      },
      setItem(k, v) {
        if (mode === 'throw') throw new DOMException('QuotaExceededError: 写入被拒绝');
        map.set(k, String(v));
      },
      removeItem(k) { if (mode === 'throw') throw new Error('nope'); map.delete(k); },
      clear() { map.clear(); }
    };
    return st;
  }

  class DOMException extends Error {}

  // ---- console（记录，便于断言"没有残留调试输出"）----
  const consoleLog = [];
  const consoleStub = {
    _all: consoleLog,
    log(...a) { consoleLog.push(['log', ...a]); },
    info(...a) { consoleLog.push(['info', ...a]); },
    warn(...a) { consoleLog.push(['warn', ...a]); },
    error(...a) { consoleLog.push(['error', ...a]); },
    debug(...a) { consoleLog.push(['debug', ...a]); }
  };

  const window = {
    devicePixelRatio: opts.dpr === undefined ? 2 : opts.dpr,
    innerWidth: 800,
    innerHeight: 900,
    localStorage: makeStorage(opts.storage || 'ok', opts.storageSeed),
    AudioContext: opts.audio === false ? undefined : FakeAudioContext,
    webkitAudioContext: undefined,
    _listeners: winListeners,
    addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const a = winListeners[type] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    setTimeout: (fn, ms) => { const id = timerId++; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    requestAnimationFrame,
    cancelAnimationFrame,
    performance: performanceStub,
    ResizeObserver: undefined
  };

  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; }
    observe() { /* 故意不主动回调，避免无限循环 */ }
    unobserve() {}
    disconnect() {}
  }

  class FakePath2D {
    moveTo() {}
    lineTo() {}
    arc() {}
    closePath() {}
  }

  const sandbox = {
    window,
    document,
    performance: performanceStub,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    Path2D: FakePath2D,
    ResizeObserver: opts.resizeObserver === false ? undefined : FakeResizeObserver,
    console: consoleStub,
    DOMException,
    self: window,
    globalThis: undefined
  };
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(patchForExport(SCRIPT_SRC), { filename: 'index.html<script>' });
  script.runInContext(context);

  const X = sandbox.__EXPORT__;
  if (!X) throw new Error('未能从 index.html 中导出内部对象');

  /* ---------------------- 驱动 API ---------------------- */
  let tickCount = 0;
  const origTick = X.Game.tick.bind(X.Game);
  X.Game.tick = function () {
    tickCount++;
    return origTick();
  };

  const api = {
    // 源码导出的内部对象
    Config: X.Config, DIR: X.DIR, STATE: X.STATE, Storage: X.Storage,
    Sfx: X.Sfx, Game: X.Game, Fx: X.Fx, Renderer: X.Renderer,
    UI: X.UI, Input: X.Input, App: X.App,

    // 环境
    window, document, els: registry, consoleLog,
    /** 拿到 localStorage 的底层 Map，便于断言"到底写进去没有" */
    storageMap: () => (window.localStorage ? window.localStorage._map : null),
    clock: () => clock.t,
    setClock: (v) => { clock.t = v; },
    tickCount: () => tickCount,
    resetTickCount: () => { tickCount = 0; },

    /** 推进一帧；不传 now 则默认 +16.7ms */
    pump(now) {
      if (typeof now === 'number') clock.t = now;
      else clock.t += 16.7;
      const q = rafQueue;
      rafQueue = [];
      for (const cb of q) cb(clock.t);
      return q.length;
    },

    /** 连续推进 n 帧，每帧 dtMs 毫秒 */
    pumpFrames(n, dtMs) {
      dtMs = dtMs === undefined ? 16.7 : dtMs;
      for (let i = 0; i < n; i++) api.pump(clock.t + dtMs);
    },

    flushTimers() {
      const q = timers.splice(0);
      for (const t of q) t.fn();
      return q.length;
    },

    /** 派发键盘事件 */
    key(k, code) {
      const ev = { type: 'keydown', key: k, code: code || '', preventDefault() {}, stopPropagation() {} };
      (docListeners['keydown'] || []).forEach((f) => f(ev));
    },

    /** 派发 document 事件（visibilitychange 等） */
    docEvent(type) {
      const ev = { type: type, preventDefault() {}, stopPropagation() {} };
      (docListeners[type] || []).forEach((f) => f(ev));
    },

    /** 派发 window 事件（blur / resize / orientationchange） */
    winEvent(type) {
      const ev = { type: type, preventDefault() {}, stopPropagation() {} };
      (winListeners[type] || []).forEach((f) => f(ev));
    },

    /** 派发触摸事件（滑动） */
    swipe(dx, dy) {
      const stage = registry.get('stage');
      stage.fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], preventDefault() {} });
      stage.fire('touchend', { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }], preventDefault() {} });
    },

    tap() {
      const stage = registry.get('stage');
      stage.fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], preventDefault() {} });
      stage.fire('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }], preventDefault() {} });
    },

    /** 点击遮罩层 / 面板按钮 */
    clickOverlay() { registry.get('overlay').fire('click', { stopPropagation() {}, preventDefault() {} }); },
    clickPanelBtn() {
      const btn = registry.get('ovBtn');
      if (btn) btn.fire('click', { stopPropagation() {}, preventDefault() {} });
    },
    clickSound() {
      registry.get('soundBtn').fire('click', { stopPropagation() {}, preventDefault() {} });
    },

    /** 把游戏置于 playing 态（走正常启动流程，同时解锁音频） */
    startPlaying() {
      api.key('ArrowRight');
      if (X.Game.state !== X.STATE.PLAYING) X.App.start();
      return X.Game.state;
    }
  };

  return api;
}

/* ------------------------------------------------------------------ *
 * 6. 通用断言辅助
 * ------------------------------------------------------------------ */
/** 蛇身是否有重复格子（正确的贪吃蛇在任何 tick 结束后都不该有） */
function hasDuplicateCells(snake) {
  const seen = new Set();
  for (const s of snake) {
    const k = s.y * 1000 + s.x;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/** 相邻两节是否真的相邻（曼哈顿距离 1） */
function isContiguous(snake) {
  for (let i = 1; i < snake.length; i++) {
    const d = Math.abs(snake[i].x - snake[i - 1].x) + Math.abs(snake[i].y - snake[i - 1].y);
    if (d !== 1) return false;
  }
  return true;
}

function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

/**
 * 把 vm 沙箱里创建的对象转成宿主侧普通对象。
 * 必须这么做：vm context 里有自己的 Object.prototype，
 * assert.deepStrictEqual 会比较原型，直接用会导致「看起来一模一样却断言失败」。
 * 这是**测试脚手架**的坑，不是源码的坑。
 */
function cellOf(c) {
  return { x: c.x, y: c.y };
}

function snakeOf(snake) {
  return snake.map(cellOf);
}

const DIR_NAMES = ['up', 'down', 'left', 'right'];

/**
 * 列出"不会立刻撞墙 / 撞身 / 反向"的方向。
 * 纯随机按键的蛇活不过 3 步就撞墙，压根长不大，
 * 测不到「长蛇咬到自己」「拥挤棋盘生成食物」这些路径。
 */
function safeDirections(api) {
  const g = api.Game;
  const head = g.snake[0];
  const cur = g.dirQueue.length ? g.dirQueue[g.dirQueue.length - 1] : g.dir;
  const out = [];
  for (const name of DIR_NAMES) {
    const d = api.DIR[name];
    if (d.x === -cur.x && d.y === -cur.y) continue;
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (nx < 0 || ny < 0 || nx >= api.Config.COLS || ny >= api.Config.ROWS) continue;
    let hit = false;
    for (let i = 0; i < g.snake.length - 1; i++) {
      if (g.snake[i].x === nx && g.snake[i].y === ny) { hit = true; break; }
    }
    if (!hit) out.push(name);
  }
  return out;
}

/** 智能驱动：优先朝食物走，同时避开必死方向 */
function autoPickDir(api, foodBias) {
  const g = api.Game;
  const safe = safeDirections(api);
  if (safe.length === 0) return DIR_NAMES[(Math.random() * 4) | 0];
  if (foodBias && Math.random() < 0.7) {
    const dx = g.food.x - g.snake[0].x;
    const dy = g.food.y - g.snake[0].y;
    const prefer = safe.filter((n) => {
      const d = api.DIR[n];
      return (dx !== 0 && d.x === Math.sign(dx)) || (dy !== 0 && d.y === Math.sign(dy));
    });
    if (prefer.length) return prefer[(Math.random() * prefer.length) | 0];
  }
  return safe[(Math.random() * safe.length) | 0];
}

module.exports = {
  HTML_TEXT,
  SCRIPT_SRC,
  createHarness,
  hasDuplicateCells,
  isContiguous,
  isOpposite,
  cellOf,
  snakeOf,
  safeDirections,
  autoPickDir,
  DIR_NAMES
};
