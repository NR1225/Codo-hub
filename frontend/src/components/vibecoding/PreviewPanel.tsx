import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, normalizePath } from '../../contexts/VibecodingContext';
import { buildPreview, pickEntry, resolvePath, PREVIEW_MSG } from './previewBuilder';
import { setPreview, pushPreviewConsole, clearPreviewConsole, subscribeTerminalOutput } from '../../utils/vibeActivity';
import {
  PlayIcon, GlobeIcon, RefreshIcon, CloseIcon, ExpandIcon, CollapseIcon, LinkIcon, StopIcon, TerminalIcon, FileIcon,
} from './icons';
import { apiService } from '../../utils/api';
import { toBrowserUrl } from '../../utils/devServer';
import { askBurkit } from '../../utils/vibeBridge';
import { emitVibe, registerPreview, useRunState, type PreviewController } from '../../utils/vibeControl';
import PreviewDevTools, { type ConsoleLine, type ConsoleLevel, type DevTab, type NetEntry } from './PreviewDevTools';
import type { Ser, ConsoleTable } from './ConsoleValue';

const MAX_LINES = 1000;
const MAX_REQUESTS = 300;
const AUTO_RELOAD_MS = 600;
// Dev-сервер: файлдар серверге жетіп, сервер оларды көргеннен кейін ғана қайта жүктейміз
const SERVER_RELOAD_MS = 1000;
const SERVER_SETTLE_MS = 300;
const EVAL_TIMEOUT_MS = 5000;

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'input', 'result'];
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock';

/* Құрылғы өлшемдері — бетті телефон/планшет енінде тексеру */
const DEVICES = [
  { id: 'responsive', w: 0, h: 0 },
  { id: 'phone', w: 375, h: 667 },
  { id: 'phone-l', w: 430, h: 932 },
  { id: 'tablet', w: 768, h: 1024 },
  { id: 'laptop', w: 1280, h: 800 },
  { id: 'desktop', w: 1920, h: 1080 },
] as const;
type DeviceId = typeof DEVICES[number]['id'];

const DEVTOOLS_KEY = 'vibe-preview-devtools';

interface DevtoolsPrefs { open: boolean; height: number; tab: DevTab; device: DeviceId; preserve: boolean; auto: boolean }

function loadDevtools(): DevtoolsPrefs {
  const fallback: DevtoolsPrefs = { open: true, height: 35, tab: 'console', device: 'responsive', preserve: false, auto: true };
  try {
    const raw = JSON.parse(localStorage.getItem(DEVTOOLS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const h = Number(raw.height);
    return {
      open: raw.open !== false,
      height: h >= 12 && h <= 88 ? h : fallback.height,
      tab: raw.tab === 'network' ? 'network' : 'console',
      device: DEVICES.some(d => d.id === raw.device) ? raw.device : 'responsive',
      preserve: raw.preserve === true,
      auto: raw.auto !== false,
    };
  } catch {
    return fallback;
  }
}

const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strMap = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 100)) out[String(k)] = String(val).slice(0, 2000);
  return out;
};
const isSer = (v: unknown): v is Ser => !!v && typeof v === 'object' && typeof (v as Ser).t === 'string';
const serList = (v: unknown): Ser[] | undefined => (Array.isArray(v) ? v.filter(isSer).slice(0, 20) : undefined);
const tableOf = (v: unknown): ConsoleTable | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as ConsoleTable;
  if (!Array.isArray(t.cols) || !Array.isArray(t.rows)) return undefined;
  return {
    cols: t.cols.slice(0, 20).map(String),
    rows: t.rows.slice(0, 100).map(r => (Array.isArray(r) ? r.slice(0, 21).map(c => String(c).slice(0, 200)) : [])),
  };
};

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const isHtmlPath = (p: string) => /\.html?$/i.test(p);
const SKIP_DIRS = /(^|\/)(node_modules|dist|build|\.git)\//;

interface PreviewPanelProps {
  /** Іске қосу сұралған сайын артады — кіру файлы қайта таңдалады */
  runId: number;
  /** Терминалда іске қосылған dev-сервердің адресі — болса, файлдардың орнына соны көрсетеді */
  serverUrl?: string | null;
  /** Dev-сервер порты — DevTools проксиі арқылы ашу үшін */
  serverPort?: number | null;
  /** Сервердің орнына жоба файлдарын (статикалық көріністі) көрсету */
  onServerClose?: () => void;
  onClose: () => void;
  /** Көріністі редактордың орнына толық жаю (тек десктопта) */
  maximized?: boolean;
  onToggleMaximize?: () => void;
}

interface PendingEval {
  resolve: (r: { ok: boolean; text: string }) => void;
  show: boolean;
  timer: number;
}

/* Жобаны sandbox iframe ішінде іске қосу (HTML/CSS/JS) немесе терминалдағы dev-серверді көрсету.
   Статикалық режимде allow-same-origin берілмейді — жоба коды сайттың cookie/localStorage-іне жете алмайды. */
const PreviewPanel: React.FC<PreviewPanelProps> = ({
  runId, serverUrl, serverPort, onServerClose, onClose, maximized, onToggleMaximize,
}) => {
  const { t } = useTranslation();
  const { activeProject, activeFile, flushProjects, dispatch } = useVibecoding();
  const run = useRunState();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(loadDevtools, []);
  const [entryPath, setEntryPath] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [buildFailed, setBuildFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [autoReload, setAutoReload] = useState(initial.auto);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const linesRef = useRef<ConsoleLine[]>([]);
  linesRef.current = lines;
  const [requests, setRequests] = useState<NetEntry[]>([]);
  const requestsRef = useRef<NetEntry[]>([]);
  requestsRef.current = requests;
  const lineId = useRef(0);
  const reqEpoch = useRef(0);
  const [preserveLog, setPreserveLog] = useState(initial.preserve);
  const preserveRef = useRef(preserveLog);
  preserveRef.current = preserveLog;

  const [devOpen, setDevOpen] = useState(initial.open);
  const [devHeight, setDevHeight] = useState(initial.height); // % — панель биіктігінен
  const [devTab, setDevTab] = useState<DevTab>(initial.tab);
  const [device, setDevice] = useState<DeviceId>(initial.device);
  const [devDragging, setDevDragging] = useState(false);
  const [bodySize, setBodySize] = useState({ w: 0, h: 0 });
  // Dev-сервер DevTools проксиі арқылы: бетке көпір енгізіледі — консоль мен желі көрінеді
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [proxyFailed, setProxyFailed] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(DEVTOOLS_KEY, JSON.stringify({
        open: devOpen, height: devHeight, tab: devTab, device, preserve: preserveLog, auto: autoReload,
      }));
    } catch { /* жеке терезе */ }
  }, [devOpen, devHeight, devTab, device, preserveLog, autoReload]);

  // ── Консоль ──

  const pushLine = useCallback((level: ConsoleLevel, text: string, extra: Partial<ConsoleLine> = {}) => {
    setLines(prev => {
      const last = prev[prev.length - 1];
      const depth = extra.depth ?? 0;
      // Қатарынан бірдей хабар — бір жол, санауышпен (DevTools сияқты)
      if (
        last && !last.system && !extra.system && !last.group && !extra.group && !extra.table && !last.table
        && level !== 'input' && level !== 'result' && last.level === level && last.text === text && last.depth === depth
      ) {
        const copy = prev.slice();
        copy[copy.length - 1] = { ...last, count: last.count + 1, time: Date.now() };
        return copy;
      }
      const line: ConsoleLine = { id: ++lineId.current, level, text, time: Date.now(), count: 1, depth, ...extra };
      return prev.length >= MAX_LINES ? [...prev.slice(-(MAX_LINES - 1)), line] : [...prev, line];
    });
    if (level !== 'input' && level !== 'result' && !extra.system) pushPreviewConsole(level, text);
  }, []);

  const clearConsole = useCallback(() => {
    setLines([]);
    clearPreviewConsole();
  }, []);
  const clearNetwork = useCallback(() => {
    reqEpoch.current += 1;
    setRequests([]);
  }, []);

  /** Жаңа құжат / қайта жүктеу: «Сақтау» қосулы болса консоль қалады, тек белгі қойылады */
  const onPageReset = useCallback((label: string) => {
    if (preserveRef.current) pushLine('log', label, { system: true });
    else clearConsole();
    clearNetwork();
  }, [pushLine, clearConsole, clearNetwork]);

  // ── Статикалық көрініс: кіру файлы және құрастыру ──

  const htmlPages = useMemo(
    () => (activeProject?.files ?? [])
      .filter(f => isHtmlPath(f.path) && !SKIP_DIRS.test(normalizePath(f.path)))
      .map(f => normalizePath(f.path))
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
    [activeProject?.files],
  );

  // Іске қосу: белсенді файлдан кіру нүктесін анықтау
  useEffect(() => {
    if (!activeProject) return;
    setEntryPath(pickEntry(activeProject, activeFile)?.path ?? null);
    setReloadKey(k => k + 1);
    // Тек жаңа іске қосуда — файл ауысқан сайын емес
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, activeProject?.id]);

  const entry = useMemo(
    () => activeProject?.files.find(f => normalizePath(f.path) === normalizePath(entryPath ?? '')) ?? null,
    [activeProject, entryPath],
  );

  const lastDoc = useRef('');
  const buildSeq = useRef(0);
  const build = useCallback((force = false) => {
    if (!activeProject || serverUrl) return;
    // Құрастыру асинхронды (TS/JSX аудармашысы жүктеледі) — тек соңғы нәтиже қолданылады
    const seq = ++buildSeq.current;
    buildPreview(activeProject, entry)
      .catch(() => ({ ok: false as const, reason: 'noEntry' as const }))
      .then(result => {
        if (seq !== buildSeq.current) return;
        setBuildFailed(!result.ok);
        const next = result.ok ? result.html : '';
        // Құжат өзгермесе iframe қайта жүктелмейді — консоль да сақталады
        if (next === lastDoc.current && !force) return;
        lastDoc.current = next;
        setSrcDoc(next);
        if (!force) onPageReset(t('vibecoding.preview.reloadedAuto', '— Файл өзгерді, бет жаңартылды —'));
      });
  }, [activeProject, entry, serverUrl, onPageReset, t]);

  // Codo қай бет іске қосылғанын білуі үшін
  useEffect(() => {
    setPreview(serverUrl ?? entry?.path ?? null);
  }, [entry?.path, serverUrl]);
  useEffect(() => () => setPreview(null), []);

  // Қолмен қайта жүктеу / жаңа іске қосу — бірден (iframe key арқылы қайта құрылады)
  useEffect(() => {
    onPageReset(t('vibecoding.preview.reloaded', '— Бет қайта жүктелді —'));
    build(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, entryPath]);

  // Файлдар өзгергенде — кідіріспен автоматты қайта жүктеу
  useEffect(() => {
    if (!autoReload || serverUrl) return;
    const timer = window.setTimeout(() => build(), AUTO_RELOAD_MS);
    return () => window.clearTimeout(timer);
  }, [autoReload, build, serverUrl]);

  // Dev-сервер режимі: файлдар өзгерсе (редактор немесе Codo) — серверге жіберіп, көріністі қайта жүктеу
  const files = activeProject?.files;
  const seenFiles = useRef(files);
  useEffect(() => {
    if (seenFiles.current === files) return;
    seenFiles.current = files;
    if (!serverUrl || !autoReload) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      flushProjects()
        .catch(() => {})
        .then(() => window.setTimeout(() => { if (!cancelled) setReloadKey(k => k + 1); }, SERVER_SETTLE_MS));
    }, SERVER_RELOAD_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [files, serverUrl, autoReload, flushProjects]);

  // ── Dev-сервер: DevTools проксиі ──

  useEffect(() => {
    setProxyUrl(null);
    setProxyFailed(false);
  }, [serverUrl, serverPort]);

  // Әр қайта жүктеуде сұраймыз: прокси ұзақ қолданылмаса жабылады, сонда жаңасы ашылады
  useEffect(() => {
    if (!serverUrl || !serverPort) return;
    let cancelled = false;
    let path = '/';
    try {
      const u = new URL(serverUrl);
      path = u.pathname + u.search;
    } catch { /* әдепкі жол */ }
    apiService.openVibecodingDevProxy(serverPort, path)
      .then(r => { if (!cancelled) setProxyUrl(toBrowserUrl(r.port, r.path)); })
      .catch(() => { if (!cancelled) setProxyFailed(true); });
    return () => { cancelled = true; };
  }, [serverUrl, serverPort, reloadKey]);

  // ── Желі ──

  // start → end → body (fetch/XHR), resource — бірден толық
  const onNet = useCallback((d: Record<string, unknown>) => {
    const phase = d.phase;
    const rawId = String(d.id ?? '');
    const id = `${reqEpoch.current}:${rawId}`;
    if (phase === 'start' || phase === 'resource') {
      const done = phase === 'resource';
      const item: NetEntry = {
        id,
        rawId,
        kind: str(d.kind, 40) || 'other',
        method: str(d.method, 20) || 'GET',
        url: str(d.url, 4000) || '',
        local: d.local === true,
        pending: !done,
        start: Date.now() - (done ? num(d.time) ?? 0 : 0),
        status: done ? num(d.status) : undefined,
        time: done ? num(d.time) : undefined,
        size: done ? num(d.size) : undefined,
        reqHeaders: strMap(d.reqHeaders),
        reqBody: str(d.reqBody) ?? null,
      };
      setRequests(prev => [...prev.slice(-(MAX_REQUESTS - 1)), item]);
      return;
    }
    setRequests(prev => {
      const i = prev.findIndex(r => r.id === id);
      if (i < 0) return prev;
      const r = prev[i];
      const next: NetEntry = phase === 'end'
        ? {
            ...r,
            pending: false,
            status: num(d.status),
            statusText: str(d.statusText, 200),
            mime: str(d.mime, 200),
            time: num(d.time),
            error: str(d.error, 500),
            resHeaders: strMap(d.resHeaders),
          }
        : { ...r, size: num(d.size) ?? r.size, preview: str(d.preview) ?? '' };
      const copy = prev.slice();
      copy[i] = next;
      return copy;
    });
  }, []);

  // ── iframe-пен хабар алмасу ──

  const evalSeq = useRef(0);
  const pendingEvals = useRef(new Map<number, PendingEval>());

  // Жаңа қойындыдағы көрініс (about:blank → sandbox iframe). Біз оны жаңартып отырамыз
  const popupRef = useRef<Window | null>(null);
  const navigateRef = useRef<(href: string) => void>(() => {});
  navigateRef.current = (href: string) => {
    if (entryPath) setEntryPath(resolvePath(entryPath, href));
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || data.source !== PREVIEW_MSG) return;
      if (data.type === 'console') {
        const level: ConsoleLevel = LEVELS.includes(data.level) && data.level !== 'input' && data.level !== 'result' ? data.level : 'log';
        pushLine(level, String(data.text ?? '').slice(0, 20000), {
          args: serList(data.args),
          depth: Math.min(20, Math.max(0, num(data.depth) ?? 0)),
          group: data.group === true || undefined,
          collapsed: data.collapsed === true || undefined,
          table: tableOf(data.table),
          trace: str(data.trace, 4000),
          src: str(data.src, 200),
        });
      } else if (data.type === 'console-clear') {
        clearConsole();
        pushLine('log', t('vibecoding.preview.consoleCleared', 'Консоль тазаланды (console.clear)'), { system: true });
      } else if (data.type === 'evalResult') {
        const pending = pendingEvals.current.get(Number(data.id));
        if (!pending) return;
        pendingEvals.current.delete(Number(data.id));
        window.clearTimeout(pending.timer);
        const ok = data.ok === true;
        const text = String(data.text ?? '').slice(0, 20000);
        const value = isSer(data.value) ? data.value : undefined;
        if (pending.show) pushLine(ok ? 'result' : 'error', text, { args: value ? [value] : undefined });
        pending.resolve({ ok, text });
      } else if (data.type === 'net') {
        onNet(data);
      } else if (data.type === 'navigate' && typeof data.href === 'string') {
        navigateRef.current(data.href);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushLine, onNet, clearConsole, t]);

  // Бет ауысса — жауабы енді келмейтін eval-дар бірден аяқталады
  useEffect(() => () => {
    pendingEvals.current.forEach(p => {
      window.clearTimeout(p.timer);
      p.resolve({ ok: false, text: 'Бет қайта жүктелді' });
    });
    pendingEvals.current.clear();
  }, [reloadKey, srcDoc, proxyUrl]);

  /** JS кодын беттің ішінде орындау. show — нәтиже консольде көрінеді */
  const evaluate = useCallback((code: string, show: boolean, timeoutMs = EVAL_TIMEOUT_MS) => (
    new Promise<{ ok: boolean; text: string }>(resolve => {
      const win = iframeRef.current?.contentWindow;
      if (!win || (serverUrl && !proxyUrl)) {
        resolve({ ok: false, text: 'Код орындайтын бет жоқ (көрініс ашылмаған немесе бет басқа доменде)' });
        return;
      }
      const id = ++evalSeq.current;
      const timer = window.setTimeout(() => {
        pendingEvals.current.delete(id);
        if (show) pushLine('error', t('vibecoding.preview.evalTimeout', 'Жауап келмеді — бет әлі жүктеліп жатыр немесе код ұзақ орындалып тұр'));
        resolve({ ok: false, text: 'Жауап келмеді (timeout)' });
      }, timeoutMs);
      pendingEvals.current.set(id, { resolve, show, timer });
      win.postMessage({ source: PREVIEW_MSG, type: 'eval', id, code }, '*');
    })
  ), [serverUrl, proxyUrl, pushLine, t]);

  const onEval = useCallback((code: string) => {
    if (!iframeRef.current?.contentWindow || (serverUrl && !proxyUrl)) {
      pushLine('error', t('vibecoding.preview.evalUnavailable', 'Код орындайтын бет жоқ'));
      return false;
    }
    pushLine('input', code);
    void evaluate(code, true);
    return true;
  }, [serverUrl, proxyUrl, pushLine, evaluate, t]);

  // Ресурс (JS, CSS …) мазмұнын бет ішінен сұрау — бет өз origin-інде оны оқи алады
  const onRequestBody = useCallback((r: NetEntry) => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !/^https?:/i.test(r.url)) return;
    win.postMessage({ source: PREVIEW_MSG, type: 'body', id: r.rawId, url: r.url }, '*');
  }, []);

  const onAskAI = useCallback((errors: string) => {
    dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: true });
    askBurkit(t('vibecoding.preview.askAIPrompt', 'Көріністің консолінде мына қателер шықты. Себебін тауып, түзетші:') + `\n\n\`\`\`text\n${errors}\n\`\`\``);
  }, [dispatch, t]);

  // ── Жаңа қойындыда ашу ──

  const pageTitle = `${entry?.path ?? activeProject?.name ?? ''} — ${t('vibecoding.preview.title', 'Көрініс')}`;

  const syncPopup = useCallback(() => {
    const w = popupRef.current;
    if (!w || w.closed) return;
    try {
      const frame = w.document.getElementById('vx-frame') as HTMLIFrameElement | null;
      if (frame && lastDoc.current) frame.srcdoc = lastDoc.current;
      w.document.title = pageTitle;
    } catch { /* терезе басқа бетке кетті */ }
  }, [pageTitle]);

  const openExternal = useCallback(() => {
    if (serverUrl) {
      window.open(serverUrl, '_blank', 'noopener');
      return;
    }
    if (!lastDoc.current) return;
    let w = popupRef.current;
    let alive = false;
    try { alive = !!w && !w.closed && !!w.document.getElementById('vx-frame'); } catch { alive = false; }
    if (!alive) {
      w = window.open('', '_blank');
      if (!w) return;
      popupRef.current = w;
      // Сыртқы бетте скрипт жоқ; жоба коды sandbox iframe ішінде (opaque origin) — сайт деректеріне жете алмайды
      w.document.open();
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<title>${escapeHtml(pageTitle)}</title>`
        + `<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style>`
        + `</head><body><iframe id="vx-frame" sandbox="${SANDBOX}"></iframe></body></html>`,
      );
      w.document.close();
      // Ішкі сілтемелер (басқа .html бетке өту) — негізгі көріністі де ауыстырады
      w.addEventListener('message', (e: MessageEvent) => {
        const d = e.data;
        if (d && d.source === PREVIEW_MSG && d.type === 'navigate' && typeof d.href === 'string') navigateRef.current(d.href);
      });
    }
    syncPopup();
    w!.focus();
  }, [serverUrl, pageTitle, syncPopup]);

  // Құжат жаңарса / қолмен қайта жүктелсе — ашық қойындыны да жаңарту
  useEffect(() => {
    syncPopup();
  }, [srcDoc, reloadKey, syncPopup]);

  // ── Құрылғы режимі ──

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBodySize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dev = DEVICES.find(d => d.id === device) ?? DEVICES[0];
  const scale = dev.w && bodySize.w
    ? Math.max(0.1, Math.min(1, (bodySize.w - 24) / dev.w, (bodySize.h - 24) / dev.h))
    : 1;

  // DevTools биіктігін сүйреп өзгерту
  const onDevResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    setDevDragging(true);
    const onMove = (ev: MouseEvent) => {
      const rect = panel.getBoundingClientRect();
      const pct = ((rect.bottom - ev.clientY) / rect.height) * 100;
      setDevHeight(Math.min(88, Math.max(12, pct)));
    };
    const onUp = () => {
      setDevDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Esc — толық жаюдан шығу
  useEffect(() => {
    if (!maximized || !onToggleMaximize) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleMaximize();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized, onToggleMaximize]);

  // ── Іске қосу күйі ──

  const sameProject = !run.projectId || run.projectId === activeProject?.id;
  const planning = sameProject && run.phase === 'planning';
  const starting = sameProject && run.phase === 'starting' && run.kind === 'server' && !serverUrl;
  const failed = sameProject && run.phase === 'error' && !serverUrl;

  // Сервер іске қосылып жатқанда — терминалдың соңғы жолдары осында да көрінеді
  const [termTail, setTermTail] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!starting && !failed) return;
    if (starting) setTermTail([]);
    let buf = '';
    const unsubscribe = subscribeTerminalOutput(text => {
      buf = (buf + text).replace(/\r\n/g, '\n').replace(/[^\n]*\r(?!\n|$)/g, '').slice(-4000);
      setTermTail(buf.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-10));
    });
    return unsubscribe;
  }, [starting, failed]);
  useEffect(() => {
    if (!starting || !run.startedAt) return;
    const tick = () => setElapsed(Math.round((Date.now() - run.startedAt!) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [starting, run.startedAt]);

  // ── Codo үшін басқару контроллері ──

  const controllerState = useRef({
    serverUrl, entry: entry?.path ?? null, device: dev.id as string, autoReload, proxyUrl, htmlPages, evaluate,
  });
  controllerState.current = {
    serverUrl: serverUrl ?? null, entry: entry?.path ?? null, device: dev.id, autoReload, proxyUrl, htmlPages, evaluate,
  };

  useEffect(() => {
    const fmtLine = (l: ConsoleLine) => {
      if (l.system) return l.text;
      const mark = l.level === 'input' ? '> ' : l.level === 'result' ? '< ' : `[${l.level}] `;
      return `${'  '.repeat(l.depth)}${mark}${l.text.slice(0, 2000)}${l.src ? ` (${l.src})` : ''}${l.count > 1 ? ` (x${l.count})` : ''}`;
    };
    const controller: PreviewController = {
      describe: () => {
        const s = controllerState.current;
        const where = s.serverUrl
          ? `dev-сервер ${s.serverUrl}${s.proxyUrl ? '' : ' (DevTools проксиі жоқ — консоль мен eval қолжетімсіз)'}`
          : s.entry ? `жоба файлы ${s.entry}` : 'іске қосатын файл табылмады';
        const pages = !s.serverUrl && s.htmlPages.length > 1 ? `; беттер: ${s.htmlPages.join(', ')}` : '';
        const errs = linesRef.current.filter(l => l.level === 'error').reduce((n, l) => n + l.count, 0);
        return `Көрініс: ${where}; экран: ${s.device}; авто-жаңарту: ${s.autoReload ? 'қосулы' : 'өшірулі'}; `
          + `консольде ${linesRef.current.length} жол (${errs} қате)${pages}`;
      },
      evaluate: (code, timeoutMs, quiet) => {
        // Codo орындаған код та консольде көрінеді — қолданушы не болғанын көреді
        if (!quiet) pushLine('input', code);
        return controllerState.current.evaluate(code, !quiet, timeoutMs);
      },
      reload: () => setReloadKey(k => k + 1),
      consoleLines: (limit = 80) => linesRef.current.slice(-limit).map(fmtLine),
      consoleMark: () => lineId.current,
      consoleSince: (mark) => linesRef.current.filter(l => l.id > mark).map(fmtLine),
      networkIssues: (limit = 30) => requestsRef.current
        .filter(r => r.error || (r.status != null && r.status >= 400) || (!r.pending && !r.status && (r.kind === 'fetch' || r.kind === 'xhr')))
        .slice(-limit)
        .map(r => `${r.method} ${r.url.slice(0, 300)} → ${r.error ?? r.status ?? 'failed'}`),
      navigate: (path) => {
        const s = controllerState.current;
        if (s.serverUrl) return false;
        const want = normalizePath(path).replace(/^\/+/, '').toLowerCase();
        const page = s.htmlPages.find(p => p.toLowerCase() === want) ?? s.htmlPages.find(p => p.toLowerCase().endsWith(`/${want}`));
        if (!page) return false;
        setEntryPath(page);
        return true;
      },
      setDevice: (id) => {
        const d = DEVICES.find(x => x.id === id);
        if (!d) return false;
        setDevice(d.id);
        return true;
      },
      devices: () => DEVICES.map(d => (d.w ? `${d.id} (${d.w}×${d.h})` : d.id)),
      clearConsole,
    };
    return registerPreview(controller);
  }, [clearConsole, pushLine]);

  // ── Кадр ──

  const serverSrc = serverUrl ? (proxyUrl ?? (proxyFailed ? serverUrl : null)) : null;
  const frame = serverSrc ? (
    /* Dev-сервер өз портында — басқа origin, сондықтан сайттың DOM/localStorage-іне жете алмайды.
       allow-same-origin керек: онсыз Vite модульдері мен HMR жүктелмейді. */
    <iframe
      key={`${serverSrc}#${reloadKey}`}
      ref={proxyUrl ? iframeRef : undefined}
      className="vx-preview__frame"
      title={t('vibecoding.preview.title', 'Көрініс')}
      sandbox={`${SANDBOX} allow-same-origin`}
      src={serverSrc}
    />
  ) : !serverUrl && !starting && !planning && srcDoc ? (
    <iframe
      key={reloadKey}
      ref={iframeRef}
      className="vx-preview__frame"
      title={t('vibecoding.preview.title', 'Көрініс')}
      sandbox={SANDBOX}
      srcDoc={srcDoc}
    />
  ) : null;

  const deviceLabel = (id: DeviceId) => {
    switch (id) {
      case 'responsive': return t('vibecoding.preview.deviceResponsive', 'Панель ені');
      case 'phone': return t('vibecoding.preview.devicePhone', 'Телефон');
      case 'phone-l': return t('vibecoding.preview.devicePhoneL', 'Үлкен телефон');
      case 'tablet': return t('vibecoding.preview.deviceTablet', 'Планшет');
      case 'laptop': return t('vibecoding.preview.deviceLaptop', 'Ноутбук');
      default: return t('vibecoding.preview.deviceDesktop', 'Компьютер');
    }
  };

  const openTerminal = () => dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: true });
  const showFiles = () => {
    emitVibe('stop', { keepPreview: true });
    onServerClose?.();
  };

  const serverRunning = !!serverUrl && run.phase === 'running' && run.kind === 'server' && sameProject;

  // Жүктелу / қате / бос күйлер
  const renderState = () => {
    if (planning) {
      return (
        <div className="vx-preview__state">
          <span className="vx-preview__spinner" />
          <p className="vx-preview__state-title">{t('vibecoding.preview.planning', 'Жоба тексерілуде…')}</p>
          <p className="vx-preview__state-sub">{t('vibecoding.preview.planningHint', 'Іске қосу тәсілі анықталып жатыр (HTML, npm, Python …)')}</p>
        </div>
      );
    }
    if (starting) {
      return (
        <div className="vx-preview__state">
          <span className="vx-preview__spinner" />
          <p className="vx-preview__state-title">
            {t('vibecoding.preview.startingTitle', 'Сервер іске қосылып жатыр')}
            {run.framework && <span className="vx-preview__badge">{run.framework}</span>}
          </p>
          <ol className="vx-preview__steps">
            <li className="is-done">{t('vibecoding.preview.stepPlan', 'Іске қосу тәсілі анықталды')}</li>
            <li className="is-done">{t('vibecoding.preview.stepTerminal', 'Команда терминалға жіберілді')}</li>
            <li className="is-active">
              {t('vibecoding.preview.stepServer', 'Сервер адресі күтілуде')}
              <span className="vx-preview__elapsed">{elapsed}s</span>
            </li>
          </ol>
          {run.command && <code className="vx-preview__cmd" title={run.command}>$ {run.command}</code>}
          {termTail.length > 0 && <pre className="vx-preview__tail">{termTail.join('\n')}</pre>}
          <div className="vx-preview__state-actions">
            <button type="button" className="vx-btn vx-btn--ghost" onClick={openTerminal}>
              <TerminalIcon size={14} />{t('vibecoding.preview.openTerminal', 'Терминал')}
            </button>
            <button type="button" className="vx-btn vx-btn--ghost" onClick={() => emitVibe('stop')}>
              <StopIcon size={14} />{t('vibecoding.preview.stop', 'Тоқтату')}
            </button>
            {htmlPages.length > 0 && (
              <button type="button" className="vx-btn vx-btn--ghost" onClick={showFiles}>
                <FileIcon size={14} />{t('vibecoding.preview.showFiles', 'Файлдардан көрсету')}
              </button>
            )}
          </div>
        </div>
      );
    }
    if (failed) {
      return (
        <div className="vx-preview__state is-error">
          <span className="vx-preview__state-icon">!</span>
          <p className="vx-preview__state-title">{t('vibecoding.preview.failedTitle', 'Жоба іске қосылмады')}</p>
          <p className="vx-preview__state-sub">{run.error}</p>
          {termTail.length > 0 && <pre className="vx-preview__tail">{termTail.join('\n')}</pre>}
          <div className="vx-preview__state-actions">
            <button type="button" className="vx-btn vx-btn--primary" onClick={() => emitVibe('run')}>
              <PlayIcon size={14} />{t('vibecoding.preview.retry', 'Қайта іске қосу')}
            </button>
            <button type="button" className="vx-btn vx-btn--ghost" onClick={openTerminal}>
              <TerminalIcon size={14} />{t('vibecoding.preview.openTerminal', 'Терминал')}
            </button>
            {htmlPages.length > 0 && (
              <button type="button" className="vx-btn vx-btn--ghost" onClick={showFiles}>
                <FileIcon size={14} />{t('vibecoding.preview.showFiles', 'Файлдардан көрсету')}
              </button>
            )}
          </div>
        </div>
      );
    }
    if (serverUrl) {
      return (
        <div className="vx-preview__state">
          <span className="vx-preview__spinner" />
          <p className="vx-preview__state-title">{t('vibecoding.preview.connecting', 'Серверге қосылып жатыр…')}</p>
        </div>
      );
    }
    return (
      <div className="vx-preview__state">
        <span className="vx-preview__state-icon"><PlayIcon size={20} /></span>
        <p className="vx-preview__state-title">
          {buildFailed || !entry
            ? t('vibecoding.preview.noEntryTitle', 'Іске қосатын файл табылмады')
            : t('vibecoding.preview.building', 'Бет құрастырылып жатыр…')}
        </p>
        {(buildFailed || !entry) && (
          <p className="vx-preview__state-sub">
            {t('vibecoding.preview.noEntry', 'Іске қосатын файл табылмады. Жобаға index.html, .js немесе .tsx файлын қосыңыз.')}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="vx-term-wrap">
      <div ref={panelRef} className={`vx-term vx-preview ${devDragging ? 'is-dragging' : ''}`}>
        <div className="vx-term__bar vx-preview__bar select-none">
          <span className="vx-term__icon">
            <GlobeIcon size={15} />
          </span>
          <span className="vx-term__title">{t('vibecoding.preview.title', 'Көрініс')}</span>

          {/* Адрес жолы: сервер адресі немесе жобаның HTML беті */}
          <div className="vx-preview__address">
            {serverUrl ? (
              <span className="vx-preview__entry vx-preview__server" title={serverUrl}>
                <span className={`vx-preview__dot ${proxyUrl || proxyFailed ? 'is-live' : ''}`} />
                <span className="vx-preview__entry-text">{serverUrl.replace(/^https?:\/\//, '')}</span>
                <button
                  type="button"
                  className="vx-preview__server-close"
                  onClick={onServerClose}
                  title={t('vibecoding.preview.serverClose', 'Жоба файлдарын көрсету')}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ) : htmlPages.length > 1 && entry && isHtmlPath(entry.path) ? (
              <select
                className="vx-preview__entry vx-preview__page-select"
                value={normalizePath(entry.path)}
                onChange={e => setEntryPath(e.target.value)}
                title={t('vibecoding.preview.page', 'Бет')}
              >
                {htmlPages.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : entry ? (
              <span className="vx-preview__entry" title={entry.path}>
                <span className="vx-preview__entry-text">{entry.path}</span>
              </span>
            ) : null}
          </div>

          <div className="vx-term__actions">
            <label className="vx-preview__auto" title={t('vibecoding.preview.autoHint', 'Файл өзгергенде қайта жүктеу')}>
              <input type="checkbox" checked={autoReload} onChange={e => setAutoReload(e.target.checked)} />
              <span>{t('vibecoding.preview.auto', 'Авто')}</span>
            </label>
            <select
              className="vx-preview__device-select"
              value={device}
              onChange={e => setDevice(e.target.value as DeviceId)}
              title={t('vibecoding.preview.device', 'Экран өлшемі')}
            >
              {DEVICES.map(d => (
                <option key={d.id} value={d.id}>
                  {deviceLabel(d.id)}{d.w ? ` ${d.w}×${d.h}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setReloadKey(k => k + 1)}
              className="vx-term__action"
              title={t('vibecoding.preview.reload', 'Қайта жүктеу')}
            >
              <RefreshIcon size={14} />
            </button>
            {serverRunning && (
              <button
                type="button"
                onClick={() => emitVibe('stop')}
                className="vx-term__action vx-term__action--danger"
                title={t('vibecoding.preview.stopServer', 'Серверді тоқтату')}
              >
                <StopIcon size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={openExternal}
              className="vx-term__action"
              disabled={!serverUrl && !srcDoc}
              title={t('vibecoding.preview.openExternal', 'Жаңа қойындыда ашу')}
            >
              <LinkIcon size={14} />
            </button>
            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                className={`vx-term__action ${maximized ? 'is-active' : ''}`}
                title={maximized
                  ? t('vibecoding.preview.restore', 'Кішірейту (Esc)')
                  : t('vibecoding.preview.maximize', 'Толық жаю')}
              >
                {maximized ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
              </button>
            )}
            <span className="vx-term__sep" />
            <button
              type="button"
              onClick={onClose}
              className="vx-term__action vx-term__action--danger"
              title={t('vibecoding.preview.close', 'Жабу')}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        <div ref={bodyRef} className={`vx-preview__body ${dev.w && frame ? 'is-device' : ''}`}>
          {frame ? (
            dev.w ? (
              <>
                <div
                  className="vx-preview__device"
                  style={{ width: dev.w, height: dev.h, transform: `translateX(-50%) scale(${scale})` }}
                >
                  {frame}
                </div>
                <span className="vx-preview__device-info">
                  {dev.w} × {dev.h} · {Math.round(scale * 100)}%
                </span>
              </>
            ) : frame
          ) : renderState()}
        </div>

        {/* DevTools — iframe ішіндегі console.* және желі сұраулары (F12 сияқты) */}
        {!starting && !planning && !failed && (
          <div className="vx-preview__devtools" style={devOpen ? { height: `${devHeight}%` } : undefined}>
            <PreviewDevTools
              lines={lines}
              requests={requests}
              open={devOpen}
              tab={devTab}
              onTabChange={setDevTab}
              onToggleOpen={() => setDevOpen(v => !v)}
              onClearConsole={clearConsole}
              onClearNetwork={clearNetwork}
              onEval={onEval}
              onResizeStart={onDevResizeStart}
              serverMode={!!serverUrl && proxyFailed && !proxyUrl}
              onRequestBody={onRequestBody}
              onOpenExternal={openExternal}
              preserveLog={preserveLog}
              onTogglePreserve={() => setPreserveLog(v => !v)}
              onAskAI={onAskAI}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
