import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrashIcon, ChevronDownIcon, CloseIcon, SearchIcon, CopyIcon, CheckIcon } from './icons';
import { ConsoleValue, ConsoleTableView, type Ser, type ConsoleTable } from './ConsoleValue';

/* Көріністің «F12» құралдары: Консоль (console.* + JS орындау) және Желі (fetch / XHR / ресурстар).
   Деректер iframe ішіндегі көпірден келеді (previewBuilder.ts → bridgeScript). */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'input' | 'result';

export interface ConsoleLine {
  id: number;
  level: ConsoleLevel;
  /** Мәтін түрі — іздеу, көшіру және Codo үшін */
  text: string;
  /** Құрылымды мәндер (ашылатын объектілер) — көпірден */
  args?: Ser[];
  time: number;
  /** Қатарынан бірдей хабар келсе — бір жол, санауышпен */
  count: number;
  /** console.group тереңдігі */
  depth: number;
  group?: boolean;
  collapsed?: boolean;
  table?: ConsoleTable;
  trace?: string;
  /** Қате шыққан жер: file.js:12:5 */
  src?: string;
  /** Сайттың өз белгісі (мысалы «Бет қайта жүктелді») */
  system?: boolean;
}

export interface NetEntry {
  id: string;
  /** Көпірдегі id — ресурс мазмұнын сұрағанда керек */
  rawId: string;
  kind: string;
  method: string;
  url: string;
  local: boolean;
  pending: boolean;
  start: number;
  status?: number;
  statusText?: string;
  mime?: string;
  time?: number;
  size?: number;
  error?: string;
  reqHeaders?: Record<string, string>;
  resHeaders?: Record<string, string>;
  reqBody?: string | null;
  preview?: string;
}

export type DevTab = 'console' | 'network';

interface Props {
  lines: ConsoleLine[];
  requests: NetEntry[];
  open: boolean;
  tab: DevTab;
  onTabChange: (tab: DevTab) => void;
  onToggleOpen: () => void;
  onClearConsole: () => void;
  onClearNetwork: () => void;
  /** JS кодын iframe ішінде орындау; false — орындайтын бет жоқ */
  onEval: (code: string) => boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  /** Dev-сервер режимі: бет басқа origin-де, ішіндегі сұрауларды көре алмаймыз */
  serverMode: boolean;
  onOpenExternal: () => void;
  /** Ресурс жауабының мазмұнын бет ішінен алу */
  onRequestBody: (r: NetEntry) => void;
  /** Қайта жүктегенде консоль тазаланбайды */
  preserveLog: boolean;
  onTogglePreserve: () => void;
  /** Қателерді Codo-ға түсіндіріп/түзетуге жіберу */
  onAskAI?: (text: string) => void;
}

type LevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';
type NetFilter = 'all' | 'fetch' | 'js' | 'css' | 'img' | 'font' | 'other';

const NET_FILTERS: { id: NetFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fetch', label: 'Fetch/XHR' },
  { id: 'js', label: 'JS' },
  { id: 'css', label: 'CSS' },
  { id: 'img', label: 'Img' },
  { id: 'font', label: 'Font' },
  { id: 'other', label: 'Other' },
];

function netType(r: NetEntry): Exclude<NetFilter, 'all'> {
  if (r.kind === 'fetch' || r.kind === 'xhr' || r.kind === 'xmlhttprequest') return 'fetch';
  const path = r.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(m?js|jsx|tsx?)$/.test(path) || r.kind === 'script') return 'js';
  if (/\.css$/.test(path) || r.kind === 'css') return 'css';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(path) || r.kind === 'img' || r.kind === 'image') return 'img';
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
  // esm.sh модульдерінде кеңейтім жоқ — бірақ олар скрипт
  if (/esm\.sh|unpkg|jsdelivr|skypack/.test(path) && (r.kind === 'other' || r.kind === 'link')) return 'js';
  return 'other';
}

const TYPE_LABEL: Record<Exclude<NetFilter, 'all'>, string> = {
  fetch: 'fetch', js: 'script', css: 'stylesheet', img: 'image', font: 'font', other: 'other',
};

function splitName(url: string): { name: string; host: string } {
  try {
    const u = new URL(url, 'http://local.invalid/');
    if (u.host === 'local.invalid') {
      const name = url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || url;
      return { name: name + (u.search || ''), host: '' };
    }
    const name = u.pathname.split('/').filter(Boolean).pop() || u.host;
    return { name: name + u.search, host: u.host };
  } catch {
    return { name: url, host: '' };
  }
}

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const formatMs = (n?: number) => (n == null ? '—' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);

const formatClock = (t: number) => {
  const d = new Date(t);
  const p = (x: number, l = 2) => String(x).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

function statusClass(r: NetEntry): string {
  if (r.pending) return 'is-pending';
  if (r.error || (!r.status && netType(r) === 'fetch')) return 'is-error';
  if (r.status && r.status >= 400) return 'is-error';
  if (r.status && r.status >= 300) return 'is-warn';
  return '';
}

function prettyBody(text: string, mime?: string): string {
  if (/json/i.test(mime || '') || /^\s*[[{]/.test(text)) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { /* JSON емес */ }
  }
  return text;
}

const LEVEL_ICON: Record<ConsoleLevel, string> = {
  log: '', info: 'ℹ', warn: '⚠', error: '✕', debug: '•', input: '›', result: '‹',
};

const HeaderList: React.FC<{ title: string; headers?: Record<string, string> }> = ({ title, headers }) => {
  const entries = Object.entries(headers || {});
  return (
    <div className="vx-dev__section">
      <div className="vx-dev__section-title">{title}</div>
      {entries.length === 0 ? (
        <div className="vx-dev__kv is-empty">—</div>
      ) : (
        entries.map(([k, v]) => (
          <div key={k} className="vx-dev__kv"><span>{k}</span><span>{v}</span></div>
        ))
      )}
    </div>
  );
};

const PreviewDevTools: React.FC<Props> = ({
  lines, requests, open, tab, onTabChange, onToggleOpen, onClearConsole, onClearNetwork,
  onEval, onResizeStart, serverMode, onOpenExternal, onRequestBody, preserveLog, onTogglePreserve, onAskAI,
}) => {
  const { t } = useTranslation();
  const [level, setLevel] = useState<LevelFilter>('all');
  const [query, setQuery] = useState('');
  const [netFilter, setNetFilter] = useState<NetFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'headers' | 'payload' | 'response'>('headers');
  const [input, setInput] = useState('');
  const history = useRef<string[]>([]);
  const historyPos = useRef(-1);
  const logsRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const [showTime, setShowTime] = useState(false);
  const [copied, setCopied] = useState(false);
  // Ашылған/жабылған топтар (console.group) — id бойынша; groupCollapsed әдепкіде жабық
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const isCollapsed = (l: ConsoleLine) => toggled[l.id] ?? !!l.collapsed;

  const errorCount = useMemo(() => lines.reduce((n, l) => n + (l.level === 'error' ? l.count : 0), 0), [lines]);
  const warnCount = useMemo(() => lines.reduce((n, l) => n + (l.level === 'warn' ? l.count : 0), 0), [lines]);
  const failedCount = useMemo(() => requests.filter(r => statusClass(r) === 'is-error').length, [requests]);

  const q = query.trim().toLowerCase();
  const shownLines = useMemo(() => {
    const out: ConsoleLine[] = [];
    let hideBelow = Infinity; // жабық топтың ішіндегі жолдар жасырылады
    for (const l of lines) {
      if (l.depth > hideBelow) continue;
      hideBelow = Infinity;
      let pass: boolean;
      if (l.system) pass = !q && level === 'all';
      else if (level === 'error') pass = l.level === 'error';
      else if (level === 'warn') pass = l.level === 'warn';
      else if (level === 'info') pass = l.level === 'info' || l.level === 'log' || l.level === 'input' || l.level === 'result';
      else if (level === 'debug') pass = l.level === 'debug';
      else pass = true;
      if (pass && q && !l.text.toLowerCase().includes(q)) pass = false;
      if (pass) out.push(l);
      if (l.group && (toggled[l.id] ?? !!l.collapsed)) hideBelow = l.depth;
    }
    return out;
  }, [lines, level, q, toggled]);

  const copyConsole = () => {
    const text = shownLines.filter(l => !l.system).map(l => {
      const mark = l.level === 'input' ? '> ' : l.level === 'result' ? '< ' : l.level === 'log' ? '' : `[${l.level}] `;
      return `${'  '.repeat(l.depth)}${mark}${l.text}${l.count > 1 ? ` (x${l.count})` : ''}`;
    }).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const askAboutErrors = () => {
    if (!onAskAI) return;
    const errs = lines.filter(l => l.level === 'error' || l.level === 'warn').slice(-15)
      .map(l => `[${l.level}] ${l.text}${l.src ? ` (${l.src})` : ''}`);
    onAskAI(errs.join('\n'));
  };

  const shownRequests = useMemo(() => requests.filter(r =>
    (netFilter === 'all' || netType(r) === netFilter) && (!q || r.url.toLowerCase().includes(q)),
  ), [requests, netFilter, q]);

  const selected = selectedId ? requests.find(r => r.id === selectedId) ?? null : null;
  const isImage = !!selected && netType(selected) === 'img';
  const asked = useRef(new Set<string>());
  // «Жауап» ашылғанда ресурс мазмұнын бір рет сұрау
  useEffect(() => {
    if (!open || tab !== 'network' || detailTab !== 'response' || !selected || isImage) return;
    if (selected.pending || selected.preview != null || asked.current.has(selected.id)) return;
    asked.current.add(selected.id);
    onRequestBody(selected);
  }, [open, tab, detailTab, selected, isImage, onRequestBody]);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  // Консоль төменге «жабысады» — пайдаланушы жоғары айналдырмаса
  useEffect(() => {
    const el = logsRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shownLines, tab, open]);

  const totals = useMemo(() => {
    let size = 0;
    let end = 0;
    let start = Infinity;
    for (const r of shownRequests) {
      size += r.size || 0;
      start = Math.min(start, r.start);
      end = Math.max(end, r.start + (r.time || 0));
    }
    return { size, span: shownRequests.length ? end - start : 0 };
  }, [shownRequests]);

  const runInput = () => {
    const code = input.trim();
    if (!code) return;
    history.current = [...history.current.filter(h => h !== code), code].slice(-50);
    historyPos.current = -1;
    stick.current = true;
    if (onEval(code)) setInput('');
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runInput();
    } else if (e.key === 'ArrowUp' && !input.includes('\n')) {
      const h = history.current;
      if (!h.length) return;
      e.preventDefault();
      historyPos.current = historyPos.current < 0 ? h.length - 1 : Math.max(0, historyPos.current - 1);
      setInput(h[historyPos.current]);
    } else if (e.key === 'ArrowDown' && !input.includes('\n') && historyPos.current >= 0) {
      e.preventDefault();
      const h = history.current;
      historyPos.current += 1;
      if (historyPos.current >= h.length) { historyPos.current = -1; setInput(''); } else setInput(h[historyPos.current]);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      onClearConsole();
    } else if (e.key === 'Escape' && input) {
      e.preventDefault();
      setInput('');
    }
  };

  const selectTab = (next: DevTab) => {
    onTabChange(next);
    if (!open) onToggleOpen();
  };

  return (
    <div className={`vx-dev ${open ? 'is-open' : ''}`}>
      {open && <div className="vx-dev__resize" onMouseDown={onResizeStart} />}
      <div className="vx-dev__bar">
        <button type="button" className="vx-dev__collapse" onClick={onToggleOpen} title="DevTools">
          <span className="vx-preview__chevron"><ChevronDownIcon size={13} /></span>
        </button>
        <div className="vx-dev__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'console'}
            className={`vx-dev__tab ${tab === 'console' ? 'is-active' : ''}`}
            onClick={() => selectTab('console')}
          >
            {t('vibecoding.preview.console', 'Консоль')}
            {errorCount > 0 && <span className="vx-preview__count is-error">{errorCount}</span>}
            {warnCount > 0 && <span className="vx-preview__count is-warn">{warnCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'network'}
            className={`vx-dev__tab ${tab === 'network' ? 'is-active' : ''}`}
            onClick={() => selectTab('network')}
          >
            {t('vibecoding.preview.network', 'Желі')}
            {requests.length > 0 && <span className="vx-preview__count">{requests.length}</span>}
            {failedCount > 0 && <span className="vx-preview__count is-error">{failedCount}</span>}
          </button>
        </div>
        <div className="vx-dev__bar-actions">
          {open && (
            <label className="vx-dev__search">
              <SearchIcon size={12} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('vibecoding.preview.filter', 'Сүзгі')}
                spellCheck={false}
              />
            </label>
          )}
          <button
            type="button"
            onClick={tab === 'console' ? onClearConsole : onClearNetwork}
            className="vx-term__action"
            title={tab === 'console'
              ? t('vibecoding.preview.clearConsole', 'Консольді тазалау')
              : t('vibecoding.preview.clearNetwork', 'Сұрауларды тазалау')}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      </div>

      {open && serverMode && (
        <div className="vx-dev__note">
          {t('vibecoding.preview.serverDevtools', 'DevTools проксиі қосылмады, сондықтан бет тікелей ашылды. Консоль мен сұрауларды көру үшін бетті жаңа қойындыда ашып, F12 басыңыз. Сервер логтары терминалда.')}
          <button type="button" className="vx-dev__link" onClick={onOpenExternal}>
            {t('vibecoding.preview.openExternal', 'Жаңа қойындыда ашу')}
          </button>
        </div>
      )}

      {open && !serverMode && tab === 'console' && (
        <>
          <div className="vx-dev__filters">
            {(['all', 'error', 'warn', 'info', 'debug'] as LevelFilter[]).map(l => (
              <button
                key={l}
                type="button"
                className={`vx-dev__chip ${level === l ? 'is-active' : ''}`}
                onClick={() => setLevel(l)}
              >
                {l === 'all' ? t('vibecoding.preview.levelAll', 'Барлығы')
                  : l === 'error' ? t('vibecoding.preview.levelErrors', 'Қателер')
                  : l === 'warn' ? t('vibecoding.preview.levelWarnings', 'Ескертулер')
                  : l === 'info' ? t('vibecoding.preview.levelInfo', 'Ақпарат')
                  : 'Debug'}
                {l === 'error' && errorCount > 0 && <span className="vx-preview__count is-error">{errorCount}</span>}
                {l === 'warn' && warnCount > 0 && <span className="vx-preview__count is-warn">{warnCount}</span>}
              </button>
            ))}
            <span className="vx-dev__filters-gap" />
            <label className="vx-dev__check" title={t('vibecoding.preview.preserveHint', 'Бет қайта жүктелгенде консоль тазаланбайды')}>
              <input type="checkbox" checked={preserveLog} onChange={onTogglePreserve} />
              <span>{t('vibecoding.preview.preserve', 'Сақтау')}</span>
            </label>
            <label className="vx-dev__check" title={t('vibecoding.preview.timestampsHint', 'Уақыт белгілерін көрсету')}>
              <input type="checkbox" checked={showTime} onChange={e => setShowTime(e.target.checked)} />
              <span>{t('vibecoding.preview.timestamps', 'Уақыт')}</span>
            </label>
            <button
              type="button"
              className={`vx-term__action ${copied ? 'is-active' : ''}`}
              onClick={copyConsole}
              disabled={shownLines.length === 0}
              title={t('vibecoding.preview.copyConsole', 'Консольді көшіру')}
            >
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            </button>
          </div>
          {onAskAI && errorCount > 0 && (
            <button type="button" className="vx-dev__ask" onClick={askAboutErrors}>
              <span className="vx-dev__ask-dot" />
              <span className="vx-dev__ask-text">{t('vibecoding.preview.askAI', 'Қателерді Codo-ға көрсету')}</span>
              <span className="vx-preview__count is-error">{errorCount}</span>
            </button>
          )}
          <div
            ref={logsRef}
            className="vx-preview__logs"
            role="log"
            onScroll={e => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {shownLines.length === 0 ? (
              <div className="vx-preview__log is-empty">{t('vibecoding.preview.consoleEmpty', 'Әзірге хабар жоқ')}</div>
            ) : (
              shownLines.map(l => l.system ? (
                <div key={l.id} className="vx-preview__log is-system">
                  <span className="vx-dev__text">{l.text}</span>
                  {showTime && <span className="vx-dev__meta"><span className="vx-dev__time">{formatClock(l.time)}</span></span>}
                </div>
              ) : (
                <div
                  key={l.id}
                  className={`vx-preview__log is-${l.level} ${l.group ? 'is-group' : ''}`}
                  style={l.depth ? { paddingLeft: `${8 + l.depth * 14}px` } : undefined}
                >
                  <span className="vx-dev__icon" aria-hidden={!l.group}>
                    {l.group ? (
                      <button
                        type="button"
                        className={`vx-dev__group ${isCollapsed(l) ? '' : 'is-open'}`}
                        onClick={() => setToggled(m => ({ ...m, [l.id]: !(m[l.id] ?? !!l.collapsed) }))}
                        aria-expanded={!isCollapsed(l)}
                      >▸</button>
                    ) : LEVEL_ICON[l.level]}
                  </span>
                  <span className="vx-dev__text">
                    {l.count > 1 && <span className="vx-dev__repeat">{l.count}</span>}
                    {l.args && l.args.length > 0 && l.level !== 'input'
                      ? l.args.map((a, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && ' '}
                          <ConsoleValue value={a} top={i === 0 || a.t !== 'str'} />
                        </React.Fragment>
                      ))
                      : l.text}
                    {l.table && <ConsoleTableView table={l.table} />}
                    {l.trace && <pre className="vx-cv__stack">{l.trace}</pre>}
                  </span>
                  {(l.src || showTime) && (
                    <span className="vx-dev__meta">
                      {l.src && <span className="vx-dev__src">{l.src}</span>}
                      {showTime && <span className="vx-dev__time">{formatClock(l.time)}</span>}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="vx-dev__input">
            <span className="vx-dev__prompt">›</span>
            <textarea
              value={input}
              rows={Math.min(6, input.split('\n').length)}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={t('vibecoding.preview.evalPlaceholder', 'JavaScript жазып, Enter басыңыз (мысалы: document.title)')}
              spellCheck={false}
              aria-label={t('vibecoding.preview.evalLabel', 'Консольге JavaScript енгізу')}
            />
          </div>
        </>
      )}

      {open && !serverMode && tab === 'network' && (
        <>
          <div className="vx-dev__filters">
            {NET_FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                className={`vx-dev__chip ${netFilter === f.id ? 'is-active' : ''}`}
                onClick={() => setNetFilter(f.id)}
              >
                {f.id === 'all' ? t('vibecoding.preview.levelAll', 'Барлығы') : f.label}
              </button>
            ))}
          </div>
          <div className="vx-net">
            <div className="vx-net__table">
              <div className="vx-net__row vx-net__head">
                <span>{t('vibecoding.preview.netName', 'Аты')}</span>
                <span>{t('vibecoding.preview.netStatus', 'Статус')}</span>
                <span>{t('vibecoding.preview.netType', 'Түрі')}</span>
                <span>{t('vibecoding.preview.netSize', 'Көлемі')}</span>
                <span>{t('vibecoding.preview.netTime', 'Уақыт')}</span>
              </div>
              <div className="vx-net__body">
                {shownRequests.length === 0 ? (
                  <div className="vx-preview__log is-empty">
                    {t('vibecoding.preview.networkEmpty', 'Сұрау әлі жоқ. Бет fetch / XHR жіберсе немесе файл жүктесе, осында көрінеді.')}
                  </div>
                ) : (
                  shownRequests.map(r => {
                    const { name, host } = splitName(r.url);
                    return (
                      <button
                        type="button"
                        key={r.id}
                        className={`vx-net__row ${statusClass(r)} ${selectedId === r.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedId(id => (id === r.id ? null : r.id))}
                        title={r.url}
                      >
                        <span className="vx-net__name">
                          {r.method !== 'GET' && <em>{r.method}</em>}
                          {name}
                          {host && <small>{host}</small>}
                          {r.local && <small>{t('vibecoding.preview.netLocal', 'жоба файлы')}</small>}
                        </span>
                        <span>{r.pending ? '…' : r.error ? '(failed)' : r.status || '—'}</span>
                        <span>{TYPE_LABEL[netType(r)]}</span>
                        <span>{formatBytes(r.size)}</span>
                        <span>{r.pending ? '…' : formatMs(r.time)}</span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="vx-net__summary">
                {shownRequests.length} {t('vibecoding.preview.netRequests', 'сұрау')} · {formatBytes(totals.size)} · {formatMs(totals.span)}
              </div>
            </div>

            {selected && (
              <div className="vx-net__detail">
                <div className="vx-net__detail-bar">
                  <button type="button" className="vx-term__action" onClick={() => setSelectedId(null)}>
                    <CloseIcon size={12} />
                  </button>
                  {(['headers', 'payload', 'response'] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      className={`vx-dev__tab ${detailTab === d ? 'is-active' : ''}`}
                      onClick={() => setDetailTab(d)}
                    >
                      {d === 'headers' ? t('vibecoding.preview.netHeaders', 'Тақырыптар')
                        : d === 'payload' ? t('vibecoding.preview.netPayload', 'Жіберілгені')
                        : t('vibecoding.preview.netResponse', 'Жауап')}
                    </button>
                  ))}
                </div>
                <div className="vx-net__detail-body">
                  {detailTab === 'headers' && (
                    <>
                      <div className="vx-dev__section">
                        <div className="vx-dev__section-title">{t('vibecoding.preview.netGeneral', 'Жалпы')}</div>
                        <div className="vx-dev__kv"><span>URL</span><span>{selected.url}</span></div>
                        <div className="vx-dev__kv"><span>Method</span><span>{selected.method}</span></div>
                        <div className="vx-dev__kv">
                          <span>Status</span>
                          <span className={statusClass(selected)}>
                            {selected.pending ? 'pending' : selected.error ? selected.error : `${selected.status ?? '—'} ${selected.statusText ?? ''}`}
                          </span>
                        </div>
                        <div className="vx-dev__kv"><span>Time</span><span>{formatMs(selected.time)}</span></div>
                      </div>
                      <HeaderList title={t('vibecoding.preview.netResHeaders', 'Жауап тақырыптары')} headers={selected.resHeaders} />
                      <HeaderList title={t('vibecoding.preview.netReqHeaders', 'Сұрау тақырыптары')} headers={selected.reqHeaders} />
                    </>
                  )}
                  {detailTab === 'payload' && (
                    <pre className="vx-net__pre">{selected.reqBody ? prettyBody(selected.reqBody) : '—'}</pre>
                  )}
                  {detailTab === 'response' && (
                    isImage && /^https?:/i.test(selected.url) ? (
                      <div className="vx-net__image">
                        <img src={selected.url} alt="" referrerPolicy="no-referrer" />
                      </div>
                    ) : (
                      <pre className="vx-net__pre">
                        {selected.preview != null
                          ? prettyBody(selected.preview, selected.mime) || '(empty)'
                          : selected.pending || /^https?:/i.test(selected.url)
                            ? t('vibecoding.preview.netLoading', 'Жүктелуде…')
                            : t('vibecoding.preview.netNoBody', 'Ресурс жауабы бұл жерде көрсетілмейді')}
                      </pre>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};


export default PreviewDevTools;
