/* Codo Hub — dev-сервер бетіндегі DevTools көпірі (services/dev_proxy.py енгізеді).
   console.* / қателерді, fetch / XHR / ресурс сұрауларын ата-бетке (Vibecoding «Көрініс») жібереді,
   ата-беттен келген JS кодын орындайды. Хабар пішімі previewBuilder.ts көпірімен бірдей. */
(function () {
  if (window.__codoBridge) return;
  window.__codoBridge = true;
  if (window.parent === window) return; // жаңа қойындыда ашылса — браузердің өз F12-сі бар
  var T = 'vibe-preview';
  var P = window.parent;
  function post(d) { try { d.source = T; P.postMessage(d, '*'); } catch (e) {} }
  function fmt(v) {
    try {
      if (v instanceof Error) return v.stack || String(v);
      if (v === undefined) return 'undefined';
      if (typeof v === 'function') return String(v).slice(0, 500);
      if (typeof Node !== 'undefined' && v instanceof Node) return (v.outerHTML || v.textContent || String(v)).slice(0, 2000);
      if (typeof v === 'object' && v !== null) return JSON.stringify(v, null, 2);
      return String(v);
    } catch (e) { return String(v); }
  }
  function send(level, args) { post({ type: 'console', level: level, text: Array.prototype.map.call(args, fmt).join(' ') }); }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (l) {
    var o = console[l];
    console[l] = function () { send(l, arguments); return o && o.apply(console, arguments); };
  });
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && e.target.tagName) {
      send('error', ['Failed to load: <' + e.target.tagName.toLowerCase() + '> ' + String(e.target.src || e.target.href || '').slice(0, 200)]);
      return;
    }
    send('error', [(e.error && e.error.stack) || ((e.message || 'Error') + (e.lineno ? ' (' + e.lineno + ':' + e.colno + ')' : ''))]);
  }, true);
  window.addEventListener('unhandledrejection', function (e) { send('error', ['Unhandled promise rejection: ' + fmt(e.reason)]); });

  // ── Желі ──
  var NID = 0;
  function net(d) { d.type = 'net'; post(d); }
  function now() { return performance.now(); }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return String(u); } }
  function hobj(h) {
    var o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach(function (v, k) { o[k] = String(v); }); return o; }
      if (Array.isArray(h)) { h.forEach(function (p) { o[p[0]] = String(p[1]); }); return o; }
      Object.keys(h).forEach(function (k) { o[k] = String(h[k]); });
    } catch (e) {}
    return o;
  }
  function body(b) {
    if (b == null) return null;
    if (typeof b === 'string') return b.slice(0, 20000);
    try {
      if (b instanceof URLSearchParams) return String(b);
      if (b instanceof FormData) { var p = []; b.forEach(function (v, k) { p.push(k + '=' + (typeof v === 'string' ? v : '[file]')); }); return p.join('&'); }
    } catch (e) {}
    return '[' + ((b.constructor && b.constructor.name) || typeof b) + ']';
  }
  var F = window.fetch;
  if (F) {
    window.fetch = function (i, o) {
      var u = typeof i === 'string' ? i : (i && i.url) || String(i);
      var id = ++NID, t0 = now();
      net({ phase: 'start', id: id, kind: 'fetch', method: String((o && o.method) || (i && i.method) || 'GET').toUpperCase(), url: abs(u), reqHeaders: hobj((o && o.headers) || (i && i.headers)), reqBody: body(o && o.body) });
      return F.apply(window, arguments).then(function (r) {
        var rh = hobj(r.headers);
        net({ phase: 'end', id: id, status: r.status, statusText: r.statusText, mime: rh['content-type'] || '', resHeaders: rh, time: now() - t0 });
        try { r.clone().text().then(function (t) { net({ phase: 'body', id: id, size: t.length, preview: t.slice(0, 20000) }); }, function () {}); } catch (e) {}
        return r;
      }, function (err) {
        net({ phase: 'end', id: id, error: String((err && err.message) || err), time: now() - t0 });
        throw err;
      });
    };
  }
  var XP = XMLHttpRequest.prototype, XO = XP.open, XS = XP.send, XH = XP.setRequestHeader;
  XP.open = function (m, u) { this.__v = { method: String(m || 'GET').toUpperCase(), url: abs(String(u)), h: {} }; return XO.apply(this, arguments); };
  XP.setRequestHeader = function (k, v) { if (this.__v) this.__v.h[k] = String(v); return XH.apply(this, arguments); };
  XP.send = function (b) {
    var x = this, v = x.__v;
    if (v) {
      var id = ++NID, t0 = now();
      net({ phase: 'start', id: id, kind: 'xhr', method: v.method, url: v.url, reqHeaders: v.h, reqBody: body(b) });
      x.addEventListener('loadend', function () {
        var t = '';
        try { if (x.responseType === '' || x.responseType === 'text') t = x.responseText; else if (x.responseType === 'json') t = JSON.stringify(x.response); } catch (e) {}
        var rh = {};
        try {
          x.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(function (l) {
            var k = l.indexOf(':');
            if (k > 0) rh[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim();
          });
        } catch (e) {}
        net({ phase: 'end', id: id, status: x.status, statusText: x.statusText, mime: rh['content-type'] || '', resHeaders: rh, time: now() - t0, error: x.status === 0 ? 'Network error' : undefined });
        net({ phase: 'body', id: id, size: t.length, preview: t.slice(0, 20000) });
      });
    }
    return XS.apply(this, arguments);
  };
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        if (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest' || /^(data|blob):/.test(e.name) || /\/__codo_bridge\.js/.test(e.name)) return;
        net({ phase: 'resource', id: 'r' + (++NID), kind: e.initiatorType || 'other', method: 'GET', url: e.name, status: e.responseStatus || 0, time: e.duration, size: e.transferSize || e.encodedBodySize || e.decodedBodySize || 0 });
      });
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  // ── Ата-беттен келетін командалар: JS орындау, ресурс мазмұнын алу ──
  window.addEventListener('message', function (e) {
    if (e.source !== P) return;
    var d = e.data;
    if (!d || d.source !== T) return;
    if (d.type === 'eval') {
      try {
        var r = (0, eval)(String(d.code));
        if (r && typeof r.then === 'function') r.then(function (v) { send('result', [v]); }, function (er) { send('error', [er]); });
        else send('result', [r]);
      } catch (er) { send('error', [er]); }
    } else if (d.type === 'body' && typeof d.url === 'string' && F) {
      F.call(window, d.url).then(function (r) { return r.text(); }).then(function (t) {
        net({ phase: 'body', id: d.id, preview: t.slice(0, 20000) });
      }, function (err) {
        net({ phase: 'body', id: d.id, preview: '(' + String((err && err.message) || err) + ')' });
      });
    }
  });
})();
