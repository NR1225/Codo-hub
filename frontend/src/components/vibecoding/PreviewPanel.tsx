import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, normalizePath } from '../../contexts/VibecodingContext';
import { buildPreview, pickEntry, resolvePath, PREVIEW_MSG } from './previewBuilder';
import { setPreview, pushPreviewConsole, clearPreviewConsole } from '../../utils/vibeActivity';
import { PlayIcon, GlobeIcon, RefreshIcon, CloseIcon, ExpandIcon, CollapseIcon, LinkIcon } from './icons';
import { apiService } from '../../utils/api';
import { toBrowserUrl } from '../../utils/devServer';
import PreviewDevTools, { type ConsoleLine, type ConsoleLevel, type DevTab, type NetEntry } from './PreviewDevTools';

const MAX_LINES = 500;
const MAX_REQUESTS = 300;
const AUTO_RELOAD_MS = 600;
// Dev-сервер: файлдар серверге жетіп, сервер оларды көргеннен кейін ғана қайта жүктейміз
const SERVER_RELOAD_MS = 1000;
const SERVER_SETTLE_MS = 300;

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

function loadDevtools(): { open: boolean; height: number; tab: DevTab; device: DeviceId } {
  const fallback = { open: true, height: 35, tab: 'console' as DevTab, device: 'responsive' as DeviceId };
  try {
    const raw = JSON.parse(localStorage.getItem(DEVTOOLS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const h = Number(raw.height);
    return {
      open: raw.open !== false,
      height: h >= 12 && h <= 88 ? h : fallback.height,
      tab: raw.tab === 'network' ? 'network' : 'console',
      device: DEVICES.some(d => d.id === raw.device) ? raw.device : 'responsive',
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

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

interface PreviewPanelProps {
  /** Іске қосу сұралған сайын артады — кіру файлы қайта таңдалады */
  runId: number;
  /** Терминалда іске қосылған dev-сервердің адресі — болса, файлдардың орнына соны көрсетеді */
  serverUrl?: string | null;
  /** Dev-сервер порты — DevTools проксиі арқылы ашу үшін */
  serverPort?: number | null;
  /** «Іске қосу» терминалда dev-серверді бастады, адресі әлі шықпады */
  serverStarting?: boolean;
  onServerClose?: () => void;
  onClose: () => void;
  /** Көріністі редактордың орнына толық жаю (тек десктопта) */
  maximized?: boolean;
  onToggleMaximize?: () => void;
}

/* Жобаны sandbox iframe ішінде іске қосу (HTML/CSS/JS).
   allow-same-origin берілмейді — жоба коды сайттың cookie/localStorage-іне қол жеткізе алмайды. */
const PreviewPanel: React.FC<PreviewPanelProps> = ({
  runId, serverUrl, serverPort, serverStarting, onServerClose, onClose, maximized, onToggleMaximize,
}) => {
  const { t } = useTranslation();
  const { activeProject, activeFile, flushProjects } = useVibecoding();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [entryPath, setEntryPath] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [autoReload, setAutoReload] = useState(true);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [requests, setRequests] = useState<NetEntry[]>([]);
  const lineId = useRef(0);
  const reqEpoch = useRef(0);

  const initial = useMemo(loadDevtools, []);
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
      localStorage.setItem(DEVTOOLS_KEY, JSON.stringify({ open: devOpen, height: devHeight, tab: devTab, device }));
    } catch { /* жеке терезе */ }
  }, [devOpen, devHeight, devTab, device]);

  const clearConsole = useCallback(() => {
    setLines([]);
    clearPreviewConsole();
  }, []);
  const clearNetwork = useCallback(() => {
    reqEpoch.current += 1;
    setRequests([]);
  }, []);

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
  const build = useCallback(() => {
    if (!activeProject) return;
    // Құрастыру асинхронды (TS/JSX аудармашысы жүктеледі) — тек соңғы нәтиже қолданылады
    const seq = ++buildSeq.current;
    buildPreview(activeProject, entry)
      .catch(() => ({ ok: false as const, reason: 'noEntry' as const }))
      .then(result => {
        if (seq !== buildSeq.current) return;
        const next = result.ok ? result.html : '';
        // Құжат өзгермесе iframe қайта жүктелмейді — консоль да сақталады
        if (next === lastDoc.current) return;
        lastDoc.current = next;
        setSrcDoc(next);
        clearConsole();
        clearNetwork();
      });
  }, [activeProject, entry, clearConsole, clearNetwork]);

  // Codo қай бет іске қосылғанын білуі үшін
  useEffect(() => {
    setPreview(entry?.path ?? null);
  }, [entry?.path]);
  useEffect(() => () => setPreview(null), []);

  // Қолмен қайта жүктеу / жаңа іске қосу — бірден (iframe key арқылы қайта құрылады)
  useEffect(() => {
    build();
    clearConsole();
    clearNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, entryPath]);

  // Файлдар өзгергенде — кідіріспен автоматты қайта жүктеу
  useEffect(() => {
    if (!autoReload) return;
    const timer = window.setTimeout(build, AUTO_RELOAD_MS);
    return () => window.clearTimeout(timer);
  }, [autoReload, build]);

  // Dev-сервер режимі: файлдар өзгерсе (редактор немесе Codo) — серверге жіберіп, көріністі қайта жүктеу.
  // Бұрын тек «Іске қосу» басқанда ғана жаңаратын, сондықтан Codo-ның өзгерістері көрінбейтін
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

  const pushLine = useCallback((level: ConsoleLevel, text: string) => {
    const line: ConsoleLine = { id: ++lineId.current, level, text, time: Date.now() };
    setLines(prev => [...prev.slice(-(MAX_LINES - 1)), line]);
    if (level !== 'input' && level !== 'result') pushPreviewConsole(level, text);
  }, []);

  // Желі оқиғалары: start → end → body (fetch/XHR), resource — бірден толық
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

  // Жаңа қойындыдағы көрініс (about:blank → sandbox iframe). Біз оны жаңартып отырамыз
  const popupRef = useRef<Window | null>(null);
  const navigateRef = useRef<(href: string) => void>(() => {});
  navigateRef.current = (href: string) => {
    if (entryPath) setEntryPath(resolvePath(entryPath, href));
  };

  // iframe-тен келетін console / желі хабарлары мен беттер арасындағы өтулер
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || data.source !== PREVIEW_MSG) return;
      if (data.type === 'console') {
        const level: ConsoleLevel = LEVELS.includes(data.level) ? data.level : 'log';
        pushLine(level, String(data.text ?? ''));
      } else if (data.type === 'net') {
        onNet(data);
      } else if (data.type === 'navigate' && typeof data.href === 'string') {
        navigateRef.current(data.href);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushLine, onNet]);

  const onEval = useCallback((code: string) => {
    const win = iframeRef.current?.contentWindow;
    if (!win || (serverUrl && !proxyUrl)) {
      pushLine('error', t('vibecoding.preview.evalUnavailable', 'Код орындайтын бет жоқ'));
      return false;
    }
    pushLine('input', code);
    win.postMessage({ source: PREVIEW_MSG, type: 'eval', code }, '*');
    return true;
  }, [serverUrl, proxyUrl, pushLine, t]);

  // Ресурс (JS, CSS …) мазмұнын бет ішінен сұрау — бет өз origin-інде оны оқи алады
  const onRequestBody = useCallback((r: NetEntry) => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !/^https?:/i.test(r.url)) return;
    win.postMessage({ source: PREVIEW_MSG, type: 'body', id: r.rawId, url: r.url }, '*');
  }, []);

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

  // Құрылғы режимі: iframe-ті бекітілген өлшемде көрсетіп, панельге сыйғызу
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBodySize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dev = DEVICES.find(d => d.id === device) ?? DEVICES[0];
  const scale = dev.w && bodySize.w
    ? Math.min(1, (bodySize.w - 24) / dev.w, (bodySize.h - 24) / dev.h)
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
  ) : !serverUrl && !serverStarting && srcDoc ? (
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

  return (
    <div className="vx-term-wrap">
      <div ref={panelRef} className={`vx-term vx-preview ${devDragging ? 'is-dragging' : ''}`}>
        <div className="vx-term__bar select-none">
          <span className="vx-term__icon">
            <GlobeIcon size={15} />
          </span>
          <span className="vx-term__title">{t('vibecoding.preview.title', 'Көрініс')}</span>
          {serverUrl ? (
            <span className="vx-preview__entry vx-preview__server" title={serverUrl}>
              {serverUrl.replace(/^https?:\/\//, '')}
              <button
                type="button"
                className="vx-preview__server-close"
                onClick={onServerClose}
                title={t('vibecoding.preview.serverClose', 'Жоба файлдарын көрсету')}
              >
                <CloseIcon size={11} />
              </button>
            </span>
          ) : (
            entry && <span className="vx-preview__entry" title={entry.path}>{entry.path}</span>
          )}

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
          ) : serverStarting || serverUrl ? (
            <div className="vx-preview__empty">
              <PlayIcon size={22} />
              <p>{t('vibecoding.preview.starting', 'Жоба іске қосылып жатыр… Терминалда барысын көре аласыз.')}</p>
            </div>
          ) : (
            <div className="vx-preview__empty">
              <PlayIcon size={22} />
              <p>{t('vibecoding.preview.noEntry', 'Іске қосатын файл табылмады. Жобаға index.html, .js немесе .tsx файлын қосыңыз.')}</p>
            </div>
          )}
        </div>

        {/* DevTools — iframe ішіндегі console.* және желі сұраулары (F12 сияқты) */}
        {!serverStarting && (
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
              serverMode={!!serverUrl && !proxyUrl}
              onRequestBody={onRequestBody}
              onOpenExternal={openExternal}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
