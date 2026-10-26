import type { Project, VirtualFile } from '../../contexts/VibecodingContext';
import { normalizePath } from '../../contexts/VibecodingContext';

/* Жобаны браузерде іске қосу: HTML кіру файлына жергілікті CSS/JS файлдарын
   тікелей енгізіп, sandbox iframe-ге берілетін бір құжат жасаймыз. */

export const PREVIEW_MSG = 'vibe-preview';

export type PreviewResult =
  | { ok: true; html: string; entry: string }
  | { ok: false; reason: 'noEntry' };

const isHtml = (p: string) => /\.html?$/i.test(p);
const isJs = (p: string) => /\.(m?js)$/i.test(p);

/** Сыртқы сілтемелер (http, //cdn, data:) жергілікті файл емес */
const isExternal = (ref: string) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);

function dirOf(path: string): string {
  const segs = normalizePath(path).split('/');
  return segs.slice(0, -1).join('/');
}

/** HTML файлына қатысты сілтемені жоба ішіндегі жолға айналдыру */
export function resolvePath(fromFile: string, ref: string): string {
  const clean = ref.split(/[?#]/)[0];
  const base = clean.startsWith('/') ? [] : dirOf(fromFile).split('/').filter(Boolean);
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') base.pop();
    else base.push(seg);
  }
  return base.join('/');
}

/** Іске қосылатын файл: белсенді HTML/JS → түбірдегі index.html → кез келген HTML → JS */
export function pickEntry(project: Project, activeFile: VirtualFile | null): VirtualFile | null {
  const files = project.files;
  if (activeFile && (isHtml(activeFile.path) || isJs(activeFile.path))) return activeFile;
  const html = files.filter(f => isHtml(f.path));
  return (
    html.find(f => normalizePath(f.path).toLowerCase() === 'index.html') ||
    html.find(f => f.name.toLowerCase() === 'index.html') ||
    html[0] ||
    files.find(f => isJs(f.path)) ||
    null
  );
}

// Енгізілген мазмұн тегті ерте жаппауы үшін
const escapeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script');
const escapeStyle = (code: string) => code.replace(/<\/style/gi, '<\\/style');

/* iframe ішіндегі console / қателерді ата-бетке жіберетін және жоба ішіндегі
   басқа HTML беттерге өтуді ұстайтын скрипт. */
const BRIDGE = `<script>(function(){
var T=${JSON.stringify(PREVIEW_MSG)};
function fmt(v){try{if(v instanceof Error)return v.stack||String(v);if(typeof v==='object'&&v!==null)return JSON.stringify(v,null,2);return String(v);}catch(e){return String(v);}}
function send(level,args){try{parent.postMessage({source:T,type:'console',level:level,text:Array.prototype.map.call(args,fmt).join(' ')},'*');}catch(e){}}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);return o&&o.apply(console,arguments);};});
window.addEventListener('error',function(e){send('error',[e.message+(e.lineno?' ('+e.lineno+':'+e.colno+')':'')]);});
window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+fmt(e.reason)]);});
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[k]=String(v);},removeItem:function(k){delete d[k];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
['localStorage','sessionStorage'].forEach(function(n){try{window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||/^([a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(h))return;if(/\\.html?([?#].*)?$/i.test(h)){e.preventDefault();parent.postMessage({source:T,type:'navigate',href:h},'*');}},true);
})();</script>`;

function inlineAssets(html: string, entryPath: string, byPath: Map<string, VirtualFile>): string {
  const find = (ref: string) => (isExternal(ref) ? undefined : byPath.get(resolvePath(entryPath, ref)));

  // <link rel="stylesheet" href="style.css"> → <style>…</style>
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const file = href && find(href);
    return file ? `<style data-file="${file.path}">\n${escapeStyle(file.content)}\n</style>` : tag;
  });

  // <script src="app.js"></script> → <script>…</script> (type сақталады)
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before, src, after) => {
    const file = find(src);
    if (!file) return tag;
    const attrs = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    return `<script${attrs ? ` ${attrs}` : ''} data-file="${file.path}">\n${escapeScript(file.content)}\n</script>`;
  });

  return html;
}

export function buildPreview(project: Project, entry: VirtualFile | null): PreviewResult {
  if (!entry) return { ok: false, reason: 'noEntry' };
  const byPath = new Map(project.files.map(f => [normalizePath(f.path), f]));

  let html: string;
  if (isJs(entry.path)) {
    // Жалғыз JS файл — бос бетте орындалады, нәтижесі консольде
    const type = /\.mjs$/i.test(entry.path) ? ' type="module"' : '';
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script${type}>\n${escapeScript(entry.content)}\n</script></body></html>`;
  } else {
    html = inlineAssets(entry.content, entry.path, byPath);
  }

  // Көпір скрипті басқа скрипттерден бұрын орындалуы керек
  // (<head> жоқ болса — DOCTYPE-тан кейін, әйтпесе бет quirks режиміне өтеді)
  const withBridge = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}${BRIDGE}`)
    : /^\s*<!doctype[^>]*>/i.test(html)
      ? html.replace(/^\s*<!doctype[^>]*>/i, (m) => `${m}${BRIDGE}`)
      : `${BRIDGE}${html}`;

  return { ok: true, html: withBridge, entry: entry.path };
}
