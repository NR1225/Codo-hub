/* Codo Hub — көрініс бетіндегі консоль көпірі (iframe ішінде орындалады).
   Бұл файл мәтін ретінде (?raw) previewBuilder.ts көпіріне кіреді; dev-сервер режиміндегі
   көшірмесі — backend/services/dev_proxy_bridge.js. Екеуін бірдей ұстаңыз.

   Сыртқы айнымалылар: T — хабар белгісі ('vibe-preview'), P — ата-бет (parent).
   Ата-бетке жіберетіні:
     {type:'console', level, text, args:[Ser], depth, group?, collapsed?, table?, trace?, src?}
     {type:'console-clear'}
     {type:'evalResult', id, ok, text, value:Ser}
   Ата-беттен қабылдайтыны: {type:'eval', id, code} */

function post(d) { try { d.source = T; P.postMessage(d, '*'); } catch (e) { /* жабылған бет */ } }

var SEEN = [];
var LIM = 100;

function ctorName(v) {
  try {
    var p = Object.getPrototypeOf(v);
    var c = p && p.constructor;
    return (c && c.name) || 'Object';
  } catch (e) { return 'Object'; }
}

/* Мәнді ата-бетке жіберуге болатын ағашқа айналдыру (DevTools-тағыдай ашылатын объектілер) */
function ser(v, depth) {
  var t = typeof v;
  if (v === null) return { t: 'null' };
  if (t === 'undefined') return { t: 'undef' };
  if (t === 'string') return { t: 'str', v: v.length > 10000 ? v.slice(0, 10000) + '…' : v };
  if (t === 'number') return { t: 'num', v: Object.is(v, -0) ? '-0' : String(v) };
  if (t === 'bigint') return { t: 'num', v: String(v) + 'n' };
  if (t === 'boolean') return { t: 'bool', v: String(v) };
  if (t === 'symbol') return { t: 'sym', v: String(v) };
  if (t === 'function') return { t: 'fn', v: v.name || 'anonymous', s: String(v).slice(0, 300) };
  try {
    if (v instanceof Error || (v && typeof v.stack === 'string' && typeof v.message === 'string')) {
      return { t: 'err', n: v.name || 'Error', v: String(v.message || ''), s: String(v.stack || '').slice(0, 4000) };
    }
    if (typeof Node !== 'undefined' && v instanceof Node) {
      if (v.nodeType === 1) {
        var tag = '<' + v.tagName.toLowerCase();
        if (v.id) tag += '#' + v.id;
        if (typeof v.className === 'string' && v.className.trim()) tag += '.' + v.className.trim().split(/\s+/).join('.');
        return { t: 'dom', v: tag + '>', h: String(v.outerHTML || '').slice(0, 3000) };
      }
      return { t: 'dom', v: v.nodeName, h: String(v.textContent || '').slice(0, 1000) };
    }
    if (v === window) return { t: 'obj', n: 'Window', e: null };
    if (v instanceof Date) return { t: 'date', v: isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString() };
    if (v instanceof RegExp) return { t: 're', v: String(v) };
    if (SEEN.indexOf(v) >= 0) return { t: 'ref', v: '[Circular]' };
    var arr = Array.isArray(v);
    var name = arr ? 'Array(' + v.length + ')' : ctorName(v);
    if (v instanceof Map) name = 'Map(' + v.size + ')';
    else if (v instanceof Set) name = 'Set(' + v.size + ')';
    if (depth >= 3) return { t: arr ? 'arr' : 'obj', n: name, e: null };
    SEEN.push(v);
    var e = [];
    var more = 0;
    if (v instanceof Map) {
      v.forEach(function (val, k) { if (e.length < LIM) e.push([typeof k === 'string' ? k : fmt(k), ser(val, depth + 1)]); else more++; });
    } else if (v instanceof Set) {
      v.forEach(function (val) { if (e.length < LIM) e.push([String(e.length), ser(val, depth + 1)]); else more++; });
    } else {
      var keys = Object.keys(v);
      for (var i = 0; i < keys.length; i++) {
        if (e.length >= LIM) { more = keys.length - i; break; }
        var val;
        try { val = v[keys[i]]; } catch (er) { val = '[?]'; }
        e.push([keys[i], ser(val, depth + 1)]);
      }
    }
    SEEN.pop();
    return { t: arr ? 'arr' : 'obj', n: name, e: e, more: more };
  } catch (er) {
    return { t: 'str', v: String(v) };
  }
}

/* Мәтін түрі — Codo-ға, іздеуге және көшіруге */
function fmt(v) {
  try {
    if (typeof v === 'string') return v;
    if (v === undefined) return 'undefined';
    if (v instanceof Error) return v.stack || String(v);
    if (typeof v === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
    if (typeof Node !== 'undefined' && v instanceof Node) return String(v.outerHTML || v.textContent || v.nodeName).slice(0, 2000);
    if (v instanceof Map) return 'Map(' + v.size + ') ' + JSON.stringify(Array.from(v.entries())).slice(0, 2000);
    if (v instanceof Set) return 'Set(' + v.size + ') ' + JSON.stringify(Array.from(v)).slice(0, 2000);
    if (typeof v === 'object' && v !== null) {
      var seen = [];
      var s = JSON.stringify(v, function (k, x) {
        if (x && typeof x === 'object') { if (seen.indexOf(x) >= 0) return '[Circular]'; seen.push(x); }
        return typeof x === 'bigint' ? String(x) + 'n' : x;
      }, 2);
      return s === undefined ? String(v) : s.slice(0, 5000);
    }
    return String(v);
  } catch (e) { return String(v); }
}

/* console.log('%s: %d', …) / '%c' стильдері */
function applyFormat(args) {
  if (typeof args[0] !== 'string' || args[0].indexOf('%') < 0 || args.length < 2) return args;
  var rest = args.slice(1);
  var objs = [];
  var head = args[0].replace(/%([sdifoOc%])/g, function (m, c) {
    if (c === '%') return '%';
    if (!rest.length) return m;
    var a = rest.shift();
    if (c === 'c') return '';
    if (c === 's') return typeof a === 'string' ? a : fmt(a);
    if (c === 'd' || c === 'i') return String(parseInt(a, 10));
    if (c === 'f') return String(parseFloat(a));
    objs.push(a);
    return '';
  });
  return [head].concat(objs, rest);
}

var GROUP_DEPTH = 0;

function send(level, args, extra) {
  var list = Array.prototype.slice.call(args);
  SEEN = [];
  var d = {
    type: 'console',
    level: level,
    text: list.map(fmt).join(' ').slice(0, 20000),
    args: list.slice(0, 20).map(function (a) { return ser(a, 0); }),
    depth: GROUP_DEPTH,
  };
  if (extra) for (var k in extra) d[k] = extra[k];
  post(d);
}

function tableOf(data, columns) {
  if (!data || typeof data !== 'object') return null;
  var keys = Array.isArray(data) ? data.map(function (_, i) { return i; }) : Object.keys(data);
  var cols = [];
  var rows = [];
  var hasValue = false;
  keys.slice(0, LIM).forEach(function (k) {
    var row = data[k];
    var cells = {};
    if (row && typeof row === 'object') {
      Object.keys(row).forEach(function (c) {
        if (columns && columns.indexOf(c) < 0) return;
        if (cols.indexOf(c) < 0) cols.push(c);
        cells[c] = fmt(row[c]).slice(0, 200);
      });
    } else {
      hasValue = true;
      cells['\u0000'] = fmt(row).slice(0, 200);
    }
    rows.push([String(k), cells]);
  });
  if (hasValue) cols.push('\u0000');
  return {
    cols: cols.slice(0, 20),
    rows: rows.map(function (r) { return [r[0]].concat(cols.slice(0, 20).map(function (c) { return r[1][c] === undefined ? '' : r[1][c]; })); }),
  };
}

(function patchConsole() {
  var C = console;
  var orig = {};
  ['log', 'info', 'warn', 'error', 'debug', 'dir', 'table', 'trace', 'assert', 'count', 'countReset',
    'time', 'timeEnd', 'timeLog', 'group', 'groupCollapsed', 'groupEnd', 'clear'].forEach(function (m) { orig[m] = C[m]; });
  var call = function (m, args) { try { if (orig[m]) orig[m].apply(C, args); } catch (e) { /* */ } };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (l) {
    C[l] = function () { send(l, applyFormat(Array.prototype.slice.call(arguments))); call(l, arguments); };
  });
  C.dir = function (v) { send('log', [v]); call('dir', arguments); };
  C.trace = function () {
    var stack = String(new Error().stack || '').split('\n').slice(2).join('\n');
    send('log', arguments.length ? applyFormat(Array.prototype.slice.call(arguments)) : ['console.trace'], { trace: stack });
    call('trace', arguments);
  };
  C.assert = function (cond) {
    if (!cond) send('error', ['Assertion failed:'].concat(Array.prototype.slice.call(arguments, 1)));
    call('assert', arguments);
  };
  var counts = {};
  C.count = function (label) {
    var l = label === undefined ? 'default' : String(label);
    counts[l] = (counts[l] || 0) + 1;
    send('info', [l + ': ' + counts[l]]);
  };
  C.countReset = function (label) { counts[label === undefined ? 'default' : String(label)] = 0; };
  var timers = {};
  C.time = function (label) { timers[label === undefined ? 'default' : String(label)] = performance.now(); };
  var elapsed = function (label, end) {
    var l = label === undefined ? 'default' : String(label);
    if (timers[l] === undefined) { send('warn', ["Timer '" + l + "' does not exist"]); return; }
    send('info', [l + ': ' + (performance.now() - timers[l]).toFixed(2) + ' ms']);
    if (end) delete timers[l];
  };
  C.timeEnd = function (label) { elapsed(label, true); };
  C.timeLog = function (label) { elapsed(label, false); };
  C.group = function () {
    send('log', arguments.length ? Array.prototype.slice.call(arguments) : ['console.group'], { group: true });
    GROUP_DEPTH++;
    call('group', arguments);
  };
  C.groupCollapsed = function () {
    send('log', arguments.length ? Array.prototype.slice.call(arguments) : ['console.group'], { group: true, collapsed: true });
    GROUP_DEPTH++;
    call('groupCollapsed', arguments);
  };
  C.groupEnd = function () { if (GROUP_DEPTH > 0) GROUP_DEPTH--; call('groupEnd', arguments); };
  C.table = function (data, columns) {
    var table = tableOf(data, Array.isArray(columns) ? columns.map(String) : null);
    send('log', [data], table ? { table: table } : undefined);
    call('table', arguments);
  };
  C.clear = function () { post({ type: 'console-clear' }); call('clear', arguments); };
})();

window.addEventListener('error', function (e) {
  var el = e.target;
  if (el && el !== window && el.tagName) {
    send('error', ['Failed to load resource: <' + el.tagName.toLowerCase() + '> ' + String(el.src || el.href || '').slice(0, 300)]);
    return;
  }
  var file = String(e.filename || '').split(/[?#]/)[0].split('/').pop();
  var src = (file && !/^(about:srcdoc|srcdoc)$/.test(file) ? file : '') + (e.lineno ? ':' + e.lineno + ':' + e.colno : '');
  send('error', [e.error || ('Uncaught ' + (e.message || 'Error'))], src ? { src: src } : undefined);
}, true);

window.addEventListener('unhandledrejection', function (e) {
  send('error', ['Uncaught (in promise)', e.reason]);
});

/* Ата-беттен келген JS: өрнек немесе код; await болса async функцияға ораймыз */
function evalCode(code) {
  var ev = eval;
  if (/^\s*\{/.test(code) && !/;\s*$/.test(code)) {
    try { return ev('(' + code + '\n)'); } catch (e) { /* блок болып шықты */ }
  }
  if (/\bawait\b/.test(code)) {
    try { return ev('(async () => (' + code + '\n))()'); } catch (e) { return ev('(async () => {' + code + '\n})()'); }
  }
  return ev(code);
}

function evalReply(id, ok, v) {
  SEEN = [];
  post({ type: 'evalResult', id: id, ok: ok, text: fmt(v).slice(0, 20000), value: ser(v, 0) });
}

window.addEventListener('message', function (e) {
  if (e.source !== P) return;
  var d = e.data;
  if (!d || d.source !== T || d.type !== 'eval') return;
  var r;
  try { r = evalCode(String(d.code)); } catch (er) { evalReply(d.id, false, er); return; }
  if (r && typeof r.then === 'function') r.then(function (v) { evalReply(d.id, true, v); }, function (er) { evalReply(d.id, false, er); });
  else evalReply(d.id, true, r);
});
