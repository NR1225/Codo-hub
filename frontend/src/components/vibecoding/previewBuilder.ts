import type { Project, VirtualFile } from '../../contexts/VibecodingContext';
import { normalizePath } from '../../contexts/VibecodingContext';

/* Жобаны браузердің өзінде іске қосу (npm/dev-серверсіз).

   HTML кіру файлынан бір құжат құрастырамыз да, sandbox iframe-ге береміз:
   • <link rel="stylesheet">, <style>, style="" — CSS ішіне кіреді; @import пен url() шешіледі;
   • <script src> — ішіне кіреді; ES модульдері import map арқылы бір-біріне сілтейді;
   • TypeScript / JSX / TSX — sucrase-пен браузерде аударылады (Vite + React жобасы да ашылады);
   • import 'react' сияқты npm пакеттері — esm.sh CDN-нен (package.json нұсқасымен);
   • import './style.css', './logo.svg', './data.json' — Vite сияқты жұмыс істейді;
   • суреттер/шрифттер/дыбыс — data: URL; fetch('data.json') мен img.src = '...' — жоба файлдарынан.
   Құрастырушы бұл жерде жеткіліксіз болатын жобалар (Vue, Svelte, Next …) — терминалдағы npm арқылы. */

export const PREVIEW_MSG = 'vibe-preview';

export type PreviewResult =
  | { ok: true; html: string; entry: string }
  | { ok: false; reason: 'noEntry' };

// ── Файл түрлері ──

const isHtml = (p: string) => /\.html?$/i.test(p);
const isScript = (p: string) => /\.(m?js|cjs|jsx|ts|tsx|mts)$/i.test(p);
const needsTranspile = (p: string) => /\.(jsx|tsx?|mts)$/i.test(p);
const isCss = (p: string) => /\.css$/i.test(p);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml',
  css: 'text/css', html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
  glsl: 'text/plain', vert: 'text/plain', frag: 'text/plain', wasm: 'application/wasm', pdf: 'application/pdf',
};
const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
const mimeOf = (p: string) => MIME[extOf(p)] ?? 'text/plain';

/** Сыртқы сілтемелер (http:, //cdn, data:, blob:, #якорь) жергілікті файл емес */
const isExternal = (ref: string) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref.trim());

function dirOf(path: string): string {
  const segs = normalizePath(path).split('/');
  return segs.slice(0, -1).join('/');
}

/** Файлға қатысты сілтемені жоба ішіндегі жолға айналдыру */
export function resolvePath(fromFile: string, ref: string): string {
  const clean = safeDecode(ref.trim().split(/[?#]/)[0]);
  const base = clean.startsWith('/') ? [] : dirOf(fromFile).split('/').filter(Boolean);
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') base.pop();
    else base.push(seg);
  }
  return base.join('/');
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Файлдың data: URL-і (сурет жүктегенде мазмұны data: түрінде сақталады) */
function toDataUrl(file: VirtualFile, mime = mimeOf(file.path)): string {
  if (file.content.startsWith('data:')) return file.content;
  return `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
}

// ── Кіру нүктесі ──

const ENTRY_SCRIPTS = [
  'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
  'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
  'main.js', 'index.js', 'script.js', 'app.js', 'main.ts', 'index.ts',
];

const depth = (p: string) => normalizePath(p).split('/').length;

/** HTML файлы осы файлға (тікелей src/href арқылы) сілтейді ме */
function htmlReferences(html: VirtualFile, target: VirtualFile): boolean {
  const want = normalizePath(target.path).toLowerCase();
  const re = /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html.content))) {
    const ref = m[1] ?? m[2] ?? m[3] ?? '';
    if (isExternal(ref)) continue;
    const p = resolvePath(html.path, ref).toLowerCase();
    if (p === want || (ref.trim().startsWith('/') && `${dirOf(html.path)}/${p}`.toLowerCase().replace(/^\//, '') === want)) return true;
  }
  return false;
}

/** Іске қосылатын файл.
    Белсенді HTML → сол. Белсенді JS/TS/CSS → оған сілтейтін HTML, болмаса негізгі index.html
    (бұрын .js/.css ашық тұрса HTML-сыз бос бет іске қосылып, стильдер жоғалатын).
    HTML мүлде жоқ болса ғана — скрипттің өзі. */
export function pickEntry(project: Project, activeFile: VirtualFile | null): VirtualFile | null {
  const files = project.files.filter(f => !/(^|\/)(node_modules|dist|build|\.git)\//.test(normalizePath(f.path)));
  if (activeFile && isHtml(activeFile.path)) return activeFile;

  const html = files.filter(f => isHtml(f.path)).sort((a, b) => depth(a.path) - depth(b.path));
  if (html.length) {
    if (activeFile && (isScript(activeFile.path) || isCss(activeFile.path))) {
      const referencing = html.find(h => htmlReferences(h, activeFile));
      if (referencing) return referencing;
    }
    return (
      html.find(f => normalizePath(f.path).toLowerCase() === 'index.html') ||
      html.find(f => f.name.toLowerCase() === 'index.html') ||
      html[0]
    );
  }

  if (activeFile && isScript(activeFile.path)) return activeFile;
  const byPath = new Map(files.map(f => [normalizePath(f.path).toLowerCase(), f]));
  for (const p of ENTRY_SCRIPTS) {
    const f = byPath.get(p);
    if (f) return f;
  }
  return files.find(f => isScript(f.path)) || null;
}

// ── HTML атрибуттары ──

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Тегтегі атрибут мәнін ауыстыру (тырнақшалы да, тырнақшасыз да) */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  return tag.replace(re, (_m, pre) => `${pre}"${escAttr(value)}"`);
}

/** Атрибуттарды қайта жазу (src, data-file т.б. алынып тасталады) */
function attrsToString(attrs: Record<string, string>, drop: string[]): string {
  return Object.entries(attrs)
    .filter(([k]) => !drop.includes(k))
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
    .join('');
}

// Енгізілген мазмұн тегті ерте жаппауы үшін
const escapeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escapeStyle = (code: string) => code.replace(/<\/style/gi, '<\\/style');
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

// ── iframe ішіндегі көпір ──

/* console / қателерді ата-бетке жіберу, жоба ішіндегі HTML беттерге өтуді ұстау,
   localStorage-ті жадымен алмастыру (sandbox-та қолжетімсіз), fetch пен img.src-ті
   жоба файлдарына бағыттау, құрастыру кезіндегі ескертулерді консольге шығару. */
function bridgeScript(entryPath: string, assets: Record<string, string>, notes: string[]): string {
  return `<script>(function(){
var T=${jsonForScript(PREVIEW_MSG)},BASE=${jsonForScript(dirOf(entryPath))},A=${jsonForScript(assets)},N=${jsonForScript(notes)};
function fmt(v){try{if(v instanceof Error)return v.stack||String(v);if(v===undefined)return 'undefined';if(typeof v==='function')return String(v).slice(0,500);if(typeof Node!=='undefined'&&v instanceof Node)return (v.outerHTML||v.textContent||String(v)).slice(0,2000);if(typeof v==='object'&&v!==null)return JSON.stringify(v,null,2);return String(v);}catch(e){return String(v);}}
function send(level,args){try{parent.postMessage({source:T,type:'console',level:level,text:Array.prototype.map.call(args,fmt).join(' ')},'*');}catch(e){}}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);return o&&o.apply(console,arguments);};});
window.addEventListener('error',function(e){if(e.target&&e.target!==window&&e.target.tagName){var s=e.target.src||e.target.href||'';send('error',['Жүктелмеді: <'+e.target.tagName.toLowerCase()+'> '+s.slice(0,200)]);return;}send('error',[(e.message||'Error')+(e.lineno?' ('+e.lineno+':'+e.colno+')':'')]);},true);
window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+fmt(e.reason)]);});
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[k]=String(v);},removeItem:function(k){delete d[k];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
['localStorage','sessionStorage'].forEach(function(n){try{window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});
if(!window.process)window.process={env:{NODE_ENV:'development'}};if(!window.global)window.global=window;
function look(u){if(typeof u!=='string'||!u||/^([a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(u))return null;var c=u.split(/[?#]/)[0];try{c=decodeURIComponent(c);}catch(e){}var b=c.charAt(0)==='/'?[]:BASE.split('/').filter(Boolean);c.split('/').forEach(function(s){if(!s||s==='.')return;if(s==='..')b.pop();else b.push(s);});var p=b.join('/').toLowerCase();return A[p]||A['public/'+p]||(BASE&&A[(BASE+'/'+p).toLowerCase()])||null;}
var NID=0;function net(d){try{d.source=T;d.type='net';parent.postMessage(d,'*');}catch(e){}}
function now(){return performance.now();}
function hobj(h){var o={};try{if(!h)return o;if(typeof h.forEach==='function'&&!Array.isArray(h)){h.forEach(function(v,k){o[k]=String(v);});return o;}if(Array.isArray(h)){h.forEach(function(p){o[p[0]]=String(p[1]);});return o;}Object.keys(h).forEach(function(k){o[k]=String(h[k]);});}catch(e){}return o;}
function body(b){if(b==null)return null;if(typeof b==='string')return b.slice(0,20000);try{if(b instanceof URLSearchParams)return String(b);if(b instanceof FormData){var p=[];b.forEach(function(v,k){p.push(k+'='+(typeof v==='string'?v:'[file]'));});return p.join('&');}}catch(e){}return '['+((b.constructor&&b.constructor.name)||typeof b)+']';}
var F=window.fetch;if(F)window.fetch=function(i,o){var u=typeof i==='string'?i:(i&&i.url)||String(i);var m=look(u);var id=++NID,t0=now();
net({phase:'start',id:id,kind:'fetch',method:String((o&&o.method)||(i&&i.method)||'GET').toUpperCase(),url:u,local:!!m,reqHeaders:hobj((o&&o.headers)||(i&&i.headers)),reqBody:body(o&&o.body)});
var p=m?F.call(window,m,o):F.apply(window,arguments);
return p.then(function(r){var rh=hobj(r.headers);net({phase:'end',id:id,status:m?200:r.status,statusText:m?'OK':r.statusText,mime:rh['content-type']||'',resHeaders:rh,time:now()-t0});
try{r.clone().text().then(function(t){net({phase:'body',id:id,size:t.length,preview:t.slice(0,20000)});},function(){});}catch(e){}return r;},
function(err){net({phase:'end',id:id,error:String((err&&err.message)||err),time:now()-t0});throw err;});};
var XP=XMLHttpRequest.prototype,XO=XP.open,XS=XP.send,XH=XP.setRequestHeader;
XP.open=function(m,u){var a=Array.prototype.slice.call(arguments);var d=look(String(u));if(d)a[1]=d;this.__v={method:String(m||'GET').toUpperCase(),url:String(u),local:!!d,h:{}};return XO.apply(this,a);};
XP.setRequestHeader=function(k,v){if(this.__v)this.__v.h[k]=String(v);return XH.apply(this,arguments);};
XP.send=function(b){var x=this,v=x.__v;if(v){var id=++NID,t0=now();net({phase:'start',id:id,kind:'xhr',method:v.method,url:v.url,local:v.local,reqHeaders:v.h,reqBody:body(b)});
x.addEventListener('loadend',function(){var t='';try{if(x.responseType===''||x.responseType==='text')t=x.responseText;else if(x.responseType==='json')t=JSON.stringify(x.response);}catch(e){}
var rh={};try{x.getAllResponseHeaders().trim().split(/[\\r\\n]+/).forEach(function(l){var k=l.indexOf(':');if(k>0)rh[l.slice(0,k).trim().toLowerCase()]=l.slice(k+1).trim();});}catch(e){}
net({phase:'end',id:id,status:v.local&&x.status===0?200:x.status,statusText:x.statusText,mime:rh['content-type']||'',resHeaders:rh,time:now()-t0,error:x.status===0&&!v.local?'Network error':undefined});
net({phase:'body',id:id,size:t.length,preview:t.slice(0,20000)});});}
return XS.apply(this,arguments);};
try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.initiatorType==='fetch'||e.initiatorType==='xmlhttprequest'||/^(data|blob):/.test(e.name))return;net({phase:'resource',id:'r'+(++NID),kind:e.initiatorType||'other',method:'GET',url:e.name,status:e.responseStatus||0,time:e.duration,size:e.transferSize||e.encodedBodySize||e.decodedBodySize||0});});}).observe({type:'resource',buffered:true});}catch(e){}
window.addEventListener('message',function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.source!==T)return;if(d.type==='body'&&typeof d.url==='string'&&F){F.call(window,d.url).then(function(r){return r.text();}).then(function(t){net({phase:'body',id:d.id,preview:t.slice(0,20000)});},function(er){net({phase:'body',id:d.id,preview:'('+String((er&&er.message)||er)+')'});});return;}if(d.type!=='eval')return;try{var r=(0,eval)(String(d.code));if(r&&typeof r.then==='function'){r.then(function(v){send('result',[v]);},function(er){send('error',[er]);});}else send('result',[r]);}catch(er){send('error',[er]);}});
function patch(C,attr){try{var d=Object.getOwnPropertyDescriptor(C.prototype,attr);if(!d||!d.set)return;Object.defineProperty(C.prototype,attr,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,look(String(v))||v);}});}catch(e){}}
[[window.HTMLImageElement,'src'],[window.HTMLMediaElement,'src'],[window.HTMLSourceElement,'src'],[window.HTMLVideoElement,'poster']].forEach(function(x){if(x[0])patch(x[0],x[1]);});
if(window.Audio){var AU=window.Audio;window.Audio=function(s){return new AU(s!=null?(look(String(s))||s):undefined);};window.Audio.prototype=AU.prototype;}
var SA=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){var k=String(n).toLowerCase();if(k==='src'||k==='poster'||(k==='href'&&this.tagName==='LINK')){var d=look(String(v));if(d)v=d;}return SA.call(this,n,v);};
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||/^([a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(h))return;if(/\\.html?([?#].*)?$/i.test(h)||h==='/'||/\\/$/.test(h)){e.preventDefault();parent.postMessage({source:T,type:'navigate',href:/\\/$/.test(h)?h+'index.html':h},'*');}},true);
N.forEach(function(n){send('warn',[n]);});
})();</script>`;
}

// ── Құрастырушы ──

type Transform = (code: string, opts: Record<string, unknown>) => { code: string };

/** Ресурстар кестесіне кіретін файлдардың жалпы шегі (iframe тым ауырламасын) */
const ASSET_BUDGET = 8 * 1024 * 1024;
const VFS = 'vfs:/';

class Builder {
  private byPath = new Map<string, VirtualFile>();
  private modules = new Map<string, string>(); // vfs:/path → data: URL
  private inProgress = new Set<string>();
  private cssSeen = new Set<string>();
  readonly notes: string[] = [];
  private deps: Record<string, string> = {};
  private userImports: Record<string, string> = {};
  private noteSet = new Set<string>();

  constructor(private project: Project, private entryPath: string, private transform: Transform | null) {
    for (const f of project.files) this.byPath.set(normalizePath(f.path).toLowerCase(), f);
    this.readPackageJson();
  }

  private note(msg: string) {
    if (this.noteSet.has(msg) || this.notes.length > 30) return;
    this.noteSet.add(msg);
    this.notes.push(msg);
  }

  /** package.json-дағы нұсқалар — esm.sh-тан дәл сол нұсқаны алу үшін */
  private readPackageJson() {
    const entryDir = dirOf(this.entryPath);
    const candidates = [entryDir ? `${entryDir}/package.json` : '', 'package.json'].filter(Boolean);
    for (const c of candidates) {
      const f = this.byPath.get(c.toLowerCase());
      if (!f) continue;
      try {
        const pkg = JSON.parse(f.content);
        this.deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
      } catch { /* бұзылған package.json — нұсқасыз жүктейміз */ }
      return;
    }
  }

  /** Сілтеме бойынша файлды табу: дәл жол → кіші әріппен → кіру папкасына қатысты → public/ */
  lookup(fromFile: string, ref: string, extensions: string[] = []): VirtualFile | undefined {
    if (isExternal(ref)) return undefined;
    const tries: string[] = [];
    const resolved = resolvePath(fromFile, ref);
    tries.push(resolved);
    if (ref.trim().startsWith('/')) {
      const root = dirOf(this.entryPath);
      if (root) tries.push(`${root}/${resolved}`);
      tries.push(`public/${resolved}`);
      if (root) tries.push(`${root}/public/${resolved}`);
    }
    for (const base of tries) {
      for (const ext of ['', ...extensions]) {
        const f = this.byPath.get((base + ext).toLowerCase());
        if (f) return f;
      }
    }
    return undefined;
  }

  private assetUrl(fromFile: string, ref: string): string | null {
    const f = this.lookup(fromFile, ref);
    return f ? toDataUrl(f) : null;
  }

  // ── CSS ──

  /** @import файлдарын ішке кіргізу, url(...) → data: URL */
  css(code: string, filePath: string): string {
    // @import url('…') немесе @import '…'. Тырнақшадағы адрестің ішінде «;» болуы мүмкін
    // (Google Fonts: wght@400;600) — бұрын адрес орнына «url(» оқылып, жалған ескерту шығатын
    const IMPORT_RE = /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)([^;]*);/gi;
    code = code.replace(IMPORT_RE, (m, _q1, urlRef: string | undefined, _q2, strRef: string | undefined, media: string) => {
      const ref = (urlRef ?? strRef ?? '').trim();
      const f = this.lookup(filePath, ref, ['.css']);
      if (!f) {
        if (!isExternal(ref)) this.note(`CSS: «${ref}» файлы табылмады (${filePath})`);
        return m;
      }
      const key = normalizePath(f.path).toLowerCase();
      if (this.cssSeen.has(key)) return '';
      this.cssSeen.add(key);
      const inner = this.css(f.content, f.path);
      this.cssSeen.delete(key);
      const mq = media.trim();
      return mq ? `@media ${mq} {\n${inner}\n}` : inner;
    });
    return this.cssUrls(code, filePath);
  }

  private cssUrls(code: string, filePath: string): string {
    return code.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, _q, ref: string) => {
      if (isExternal(ref) || ref.startsWith('#')) return m;
      const url = this.assetUrl(filePath, ref);
      if (!url) {
        this.note(`CSS: «${ref}» файлы табылмады (${filePath})`);
        return m;
      }
      return `url("${url.replace(/"/g, '%22')}")`;
    });
  }

  // ── ES модульдері ──

  /** npm пакеті → esm.sh (package.json-дағы нұсқамен) */
  private bareUrl(spec: string): string {
    const m = spec.match(/^((?:@[^/]+\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/);
    if (!m) return `https://esm.sh/${spec}`;
    const [, name, explicitVer, sub = ''] = m;
    let ver = explicitVer ?? this.deps[name] ?? '';
    if (!/^[\^~]?\d|^[<>=]|^\*$|^latest$|^next$/.test(ver)) ver = ''; // workspace:, file:, git+ …
    return `https://esm.sh/${name}${ver ? `@${ver.replace(/\s+/g, '')}` : ''}${sub}`;
  }

  /** import/export сілтемелерін қайта жазу: жергілікті → vfs:/…, npm → esm.sh */
  private rewriteImports(code: string, filePath: string): string {
    const fix = (spec: string): string => {
      if (/^(https?:|data:|blob:|vfs:)/i.test(spec)) return spec;
      if (spec.startsWith('node:')) {
        this.note(`«${spec}» — Node.js модулі браузерде жоқ. Мұндай жобаны терминалда іске қосыңыз.`);
        return spec;
      }
      if (this.userImports[spec] !== undefined) return spec; // қолданушының import map-і шешеді
      let ref = spec;
      if (/^[@~]\//.test(spec)) ref = `/src/${spec.slice(2)}`; // Vite/TS алиасы: @/x → src/x
      if (ref.startsWith('.') || ref.startsWith('/')) {
        const f = this.lookup(filePath, ref, [
          '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json',
          '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
        ]);
        if (!f) {
          this.note(`Модуль табылмады: «${spec}» (${filePath})`);
          return spec;
        }
        return this.module(f);
      }
      return this.bareUrl(spec);
    };
    const quoted = (pre: string, q: string, spec: string) => `${pre}${q}${fix(spec)}${q}`;
    return code
      // import x from '…' / export … from '…'
      .replace(/(\bfrom\s*)(["'])([^"'\n]+)\2/g, (_m, pre, q, s) => quoted(pre, q, s))
      // import '…' (жанама әсер үшін)
      .replace(/((?:^|[;\s}])import\s*)(["'])([^"'\n]+)\2/g, (_m, pre, q, s) => quoted(pre, q, s))
      // import('…')
      .replace(/(\bimport\s*\(\s*)(["'])([^"'\n]+)\2(\s*\))/g, (_m, pre, q, s, post) => quoted(pre, q, s) + post);
  }

  private compile(code: string, filePath: string): string {
    const ts = /\.(tsx?|mts)$/i.test(filePath);
    const jsx = /\.(jsx|tsx)$/i.test(filePath) || (/\.m?js$/i.test(filePath) && /<\/[A-Za-z]|\/>/.test(code) && /<[A-Za-z]/.test(code));
    if (!ts && !jsx) return code;
    if (!this.transform) {
      this.note(`${filePath}: TypeScript/JSX аудармашысы жүктелмеді`);
      return code;
    }
    const transforms = [...(ts ? ['typescript'] : []), ...(jsx ? ['jsx'] : [])];
    try {
      return this.transform(code, {
        transforms,
        jsxRuntime: 'automatic',
        production: true,
        disableESTransforms: true,
        filePath,
      }).code;
    } catch (e) {
      // .js ішінде JSX жоқ болып шықса — өзгеріссіз
      if (!ts && !/\.(jsx|tsx)$/i.test(filePath)) return code;
      const msg = e instanceof Error ? e.message : String(e);
      this.note(`${filePath}: аудару қатесі — ${msg}`);
      return `throw new SyntaxError(${JSON.stringify(`${filePath}: ${msg}`)});`;
    }
  }

  /** Модуль кодын дайындау (аудару + import-тарды қайта жазу + import.meta.env) */
  moduleCode(code: string, filePath: string): string {
    let out = this.rewriteImports(this.compile(code, filePath), filePath);
    if (out.includes('import.meta.env')) {
      out = `import.meta.env={MODE:'development',DEV:true,PROD:false,SSR:false,BASE_URL:'/'};\n${out}`;
    }
    return out;
  }

  /** Файлды ES модуліне айналдырып, import map кілтін қайтару */
  module(file: VirtualFile): string {
    const path = normalizePath(file.path);
    const key = VFS + path.split('/').map(encodeURIComponent).join('/');
    if (this.modules.has(key) || this.inProgress.has(key)) return key;
    this.inProgress.add(key);

    let code: string;
    if (isCss(path)) {
      const css = this.css(file.content, path);
      const cssModule = /\.module\.css$/i.test(path);
      const classes: Record<string, string> = {};
      if (cssModule) for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes[m[1]] = m[1];
      code = `const s=document.createElement('style');s.dataset.file=${JSON.stringify(path)};s.textContent=${JSON.stringify(css)};document.head.appendChild(s);export default ${cssModule ? JSON.stringify(classes) : JSON.stringify(css)};`;
    } else if (/\.json$/i.test(path)) {
      let ok = true;
      try { JSON.parse(file.content); } catch { ok = false; }
      code = ok ? `export default ${file.content};` : `throw new SyntaxError(${JSON.stringify(`${path}: JSON қатесі`)});`;
    } else if (isScript(path)) {
      code = this.moduleCode(file.content, path);
    } else if (/\.(vue|svelte|astro)$/i.test(path)) {
      this.note(`${path}: бұл форматты браузер өзі аша алмайды — терминалда «npm run dev» іске қосыңыз.`);
      code = 'export default {};';
    } else {
      // Сурет, шрифт, мәтін — Vite сияқты: import logo from './logo.svg' → URL
      code = `export default ${JSON.stringify(toDataUrl(file))};`;
    }

    this.inProgress.delete(key);
    this.modules.set(key, `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);
    return key;
  }

  // ── HTML ──

  html(source: string): string {
    const entry = this.entryPath;

    // Қолданушының өз import map-і — біздікімен біріктіріледі
    let html = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs: string, body: string) => {
      if (parseAttrs(attrs).type?.toLowerCase() !== 'importmap') return m;
      try { Object.assign(this.userImports, JSON.parse(body).imports ?? {}); } catch { this.note('import map JSON қатесі'); }
      return '';
    });

    // <link rel="stylesheet|icon|preload|…">
    html = html.replace(/<link\b([^>]*)>/gi, (tag, attrStr: string) => {
      const a = parseAttrs(attrStr);
      const href = a.href;
      if (!href || isExternal(href)) return tag;
      const rel = (a.rel ?? '').toLowerCase();
      if (/\bstylesheet\b/.test(rel)) {
        const f = this.lookup(entry, href, ['.css']);
        if (!f) {
          this.note(`<link href="${href}"> — файл табылмады`);
          return tag;
        }
        const media = a.media ? ` media="${escAttr(a.media)}"` : '';
        return `<style data-file="${escAttr(f.path)}"${media}>\n${escapeStyle(this.css(f.content, f.path))}\n</style>`;
      }
      if (/\bmodulepreload\b/.test(rel)) return '';
      const url = this.assetUrl(entry, href);
      return url ? setAttr(tag, 'href', url) : tag;
    });

    // <style> блоктары
    html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, open: string, body: string, close: string) =>
      /data-file=/.test(open) ? m : `${open}${escapeStyle(this.css(body, entry))}${close}`);

    // <script> — сыртқы файлдар ішке, модульдер import map-пен
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrStr: string, body: string) => {
      const a = parseAttrs(attrStr);
      const type = (a.type ?? '').toLowerCase();
      const src = a.src;
      let code = body;
      let path = entry;
      if (src && !isExternal(src)) {
        const f = this.lookup(entry, src, ['.js', '.ts']);
        if (!f) {
          this.note(`<script src="${src}"> — файл табылмады`);
          return m;
        }
        code = f.content;
        path = normalizePath(f.path);
      } else if (src) {
        return m; // CDN скрипті — өзгеріссіз
      }

      const jsType = !type || /^(module|text\/javascript|application\/javascript|text\/typescript|text\/jsx|text\/tsx)$/.test(type);
      if (!jsType) {
        // text/babel, x-shader, шаблондар — мазмұнын ғана ішке кіргіземіз
        const rest = attrsToString(a, ['src']);
        return `<script${rest}${src ? ` data-file="${escAttr(path)}"` : ''}>\n${escapeScript(code)}\n</script>`;
      }

      const isModule = type === 'module' || needsTranspile(path) || /^text\/(typescript|tsx|jsx)$/.test(type);
      const rest = attrsToString(a, ['src', 'type', 'async', 'defer', 'integrity', 'crossorigin']);
      if (isModule) {
        // Сыртқы модуль файлы — vfs кілті арқылы (оның import-тары соған қатысты шешіледі)
        const content = src
          ? `import ${JSON.stringify(this.module(this.byPath.get(path.toLowerCase())!))};`
          : this.moduleCode(code, /^text\/(typescript|tsx)$/.test(type) ? `${entry}.tsx` : type === 'text/jsx' ? `${entry}.jsx` : entry);
        return `<script type="module"${rest}${src ? ` data-file="${escAttr(path)}"` : ''}>\n${escapeScript(content)}\n</script>`;
      }
      // defer/async алынды: ішке кірген скрипт құжаттағы орнында ретімен орындалады
      return `<script${rest}${src ? ` data-file="${escAttr(path)}"` : ''}>\n${escapeScript(code)}\n</script>`;
    });

    // Суреттер, видео, дыбыс: src / poster / srcset / style="url(...)"
    html = html.replace(/<(img|source|video|audio|track|embed|input|image|use)\b[^>]*>/gi, (tag) => {
      let out = tag;
      const a = parseAttrs(tag.replace(/^<\w+|\/?>$/g, ''));
      for (const name of ['src', 'poster', 'href', 'xlink:href', 'data']) {
        const v = a[name];
        if (!v || isExternal(v)) continue;
        const url = this.assetUrl(entry, v);
        if (url) out = setAttr(out, name.replace(':', '\\:'), url);
        else if (name !== 'href' && name !== 'xlink:href') this.note(`<${tag.match(/^<(\w+)/)?.[1]} ${name}="${v}"> — файл табылмады`);
      }
      if (a.srcset) {
        const srcset = a.srcset.split(',').map(part => {
          const [u, ...d] = part.trim().split(/\s+/);
          const url = u && !isExternal(u) ? this.assetUrl(entry, u) : null;
          return [url ?? u, ...d].join(' ');
        }).join(', ');
        out = setAttr(out, 'srcset', srcset);
      }
      return out;
    });
    html = html.replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, pre: string, dq?: string, sq?: string) => {
      const style = dq ?? sq ?? '';
      if (!/url\(/i.test(style)) return m;
      const fixed = this.cssUrls(style.replace(/&quot;/g, '"'), entry);
      return `${pre}"${fixed.replace(/"/g, '&quot;')}"`;
    });

    return html;
  }

  /** Модуль кілттері + қолданушының import map-і */
  importMap(): string {
    if (!this.modules.size && !Object.keys(this.userImports).length) return '';
    const imports = { ...Object.fromEntries(this.modules), ...this.userImports };
    return `<script type="importmap">${jsonForScript({ imports })}</script>`;
  }

  /** fetch / img.src үшін файлдар кестесі (кіші әріппен жол → data: URL) */
  assets(): Record<string, string> {
    const out: Record<string, string> = {};
    let total = 0;
    const files = [...this.project.files]
      .filter(f => !isHtml(f.path) && !isScript(f.path) && !/(^|\/)(node_modules|\.git|dist)\//.test(f.path))
      .filter(f => !/(^|\/)(package(-lock)?\.json|tsconfig[\w.]*\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(f.path))
      .sort((a, b) => a.content.length - b.content.length);
    for (const f of files) {
      const url = toDataUrl(f);
      if (total + url.length > ASSET_BUDGET) break;
      total += url.length;
      out[normalizePath(f.path).toLowerCase()] = url;
    }
    return out;
  }
}

let transformPromise: Promise<Transform | null> | null = null;
/** sucrase — тек TS/JSX файлы бар жобада ғана жүктеледі */
function loadTransform(): Promise<Transform | null> {
  transformPromise ??= import('sucrase')
    .then(m => m.transform as unknown as Transform)
    .catch(() => { transformPromise = null; return null; });
  return transformPromise;
}

export async function buildPreview(project: Project, entry: VirtualFile | null): Promise<PreviewResult> {
  if (!entry) return { ok: false, reason: 'noEntry' };
  const transform = project.files.some(f => needsTranspile(f.path) || (isHtml(f.path) && /text\/(typescript|tsx|jsx)/i.test(f.content)))
    ? await loadTransform()
    : null;

  const b = new Builder(project, normalizePath(entry.path), transform);
  let html: string;

  if (isScript(entry.path)) {
    const path = normalizePath(entry.path);
    const moduleish = needsTranspile(path) || /\.mjs$/i.test(path) || /^\s*(import|export)\s/m.test(entry.content);
    // HTML-сыз скрипт — бос бетте орындалады (React үшін #root/#app бар), нәтижесі консольде
    const script = moduleish
      ? `<script type="module">import ${JSON.stringify(b.module(entry))};</script>`
      : `<script data-file="${escAttr(path)}">\n${escapeScript(entry.content)}\n</script>`;
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><div id="app"></div>${script}</body></html>`;
  } else {
    html = b.html(entry.content);
  }

  // Көпір мен import map басқа скрипттерден бұрын тұруы керек
  // (<head> жоқ болса — DOCTYPE-тан кейін, әйтпесе бет quirks режиміне өтеді)
  const head = bridgeScript(entry.path, b.assets(), b.notes) + b.importMap();
  const withHead = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}${head}`)
    : /^\s*<!doctype[^>]*>/i.test(html)
      ? html.replace(/^\s*<!doctype[^>]*>/i, (m) => `${m}${head}`)
      : `${head}${html}`;

  return { ok: true, html: withHead, entry: entry.path };
}
