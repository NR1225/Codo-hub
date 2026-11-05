import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal, ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import i18n from '../i18n/config';
import '@xterm/xterm/css/xterm.css';
import TerminalWebSocketService, { TerminalSessionInfo, TerminalConnState } from '../utils/terminalWebSocket';
import type { WorkspaceChanges } from '../contexts/VibecodingContext';
import { DEV_SERVER_EVENT, toBrowserUrl, type DevServerInfo } from '../utils/devServer';
import { appendTerminalOutput, trackTerminalInput, setTerminalConnected, logEvent } from '../utils/vibeActivity';

export interface UseTerminalOptions {
  /** Терминал осы жобаның папкасында ашылады */
  projectId?: string | null;
  /** Жүктелген жобаның (кодты көру беті) көшірмесінде ашылады */
  codeId?: string | null;
  onConnect?: (info: TerminalSessionInfo) => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
  onFsChanges?: (projectId: string, changes: WorkspaceChanges) => void;
  /** Шрифт өлшемі (барлық табқа ортақ, панель басқарады) */
  fontSize?: number;
  /** Терминалдағы жолды жобаның файлына айналдыру (жоқ болса — null, сілтеме болмайды) */
  resolveFile?: (path: string) => string | null;
  /** file.py:12 сілтемесі басылды */
  onOpenFile?: (path: string, line: number, column: number) => void;
  /** Терминал ішіндегі пернелер: Ctrl+F, Ctrl +/-/0 */
  onShortcut?: (action: TerminalShortcut) => void;
  /** Шығыста қате пайда болды (Traceback, Error: …) */
  onErrorOutput?: () => void;
  /** Қолданушы Enter басты; командасы анық болса — мәтіні, әйтпесе null */
  onSubmit?: (command: string | null) => void;
  /** Түс тақырыбы: Vibecoding сайт тақырыбына ереді, қалғандары — қара (әдепкі) */
  theme?: 'dark' | 'light';
  /** Берілсе — компонент жабылғанда (бет ауысқанда) сессия тоқтамай фонда қалады,
   *  сол кілтпен қайта ашылғанда жалғасады. Толық тоқтату — disposeTerminalSession(key). */
  persistKey?: string;
}

export type TerminalShortcut =
  | 'find' | 'zoom-in' | 'zoom-out' | 'zoom-reset'
  /** Табтар арасында ауысу: келесі/алдыңғы немесе N-ші таб (1-ден) */
  | 'next-tab' | 'prev-tab' | { tab: number };

export interface TerminalSearchResult {
  index: number;
  count: number;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  isConnected: boolean;
  status: TerminalConnState;
  session: TerminalSessionInfo | null;
  error: string | null;
  connect: (getToken: () => Promise<string | null>) => void;
  disconnect: () => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
  requestSync: () => void;
  /** Командаларды shell-ге жіберу (Enter-мен бірге) */
  sendText: (text: string) => void;
  /** Жұмыс істеп тұрған процесті тоқтату (Ctrl+C) */
  interrupt: () => void;
  copySelection: () => boolean;
  paste: () => void;
  selectAll: () => void;
  getSelection: () => string;
  /** Буфердің соңғы N жолы (бос жолдарсыз) */
  getRecentText: (lines: number) => string;
  findNext: (query: string, incremental?: boolean) => boolean;
  findPrevious: (query: string) => boolean;
  clearSearch: () => void;
  searchResult: TerminalSearchResult | null;
}

// Шығыстағы қате белгілері (ANSI түстерін алып тастаған соң тексеріледі)
const ERROR_RE = /Traceback \(most recent call last\)|\b[A-Z]\w*(?:Error|Exception)\b|\bnpm ERR!|\berror(?:\[\w+\])?:|command not found|is not recognized as|No such file or directory|\bFAILED\b/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

// Python: File "app/main.py", line 12
const PY_LINK_RE = /File "([^"]+)", line (\d+)/g;
// Жалпы: src/app.ts:12:5, main.go:8, ./index.js(3,7), C:\x\main.py:4
const PATH_LINK_RE = /((?:[A-Za-z]:)?[\w./\\-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\d+)(?::(\d+))?|\((\d+),\s?(\d+)\))?/g;
const URL_RE = /https?:\/\/\S+/g;

const DARK_THEME = {
  // Қара монохром палитра (кодтар беті т.б.)
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#fafafa',
  cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  black: '#000000',
  red: '#ff6b6b',
  green: '#51cf66',
  yellow: '#ffd43b',
  blue: '#339af0',
  magenta: '#cc5de8',
  cyan: '#67e8f9',
  white: '#d4d4d4',
  brightBlack: '#6b6b6b',
  brightRed: '#ff8787',
  brightGreen: '#69db7c',
  brightYellow: '#ffe066',
  brightBlue: '#74c0fc',
  brightMagenta: '#e599f7',
  brightCyan: '#66d9e8',
  brightWhite: '#ffffff',
};

const LIGHT_THEME = {
  // Vibecoding бетінің ақ монохром палитрасы
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#0a0a0a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0, 0, 0, 0.15)',
  black: '#1a1a1a',
  red: '#d32f2f',
  green: '#2e7d32',
  yellow: '#a16207',
  blue: '#1d4ed8',
  magenta: '#9333ea',
  cyan: '#0e7490',
  white: '#6b6b6b',
  brightBlack: '#8a8a8a',
  brightRed: '#dc2626',
  brightGreen: '#16a34a',
  brightYellow: '#b45309',
  brightBlue: '#2563eb',
  brightMagenta: '#a855f7',
  brightCyan: '#0891b2',
  brightWhite: '#0a0a0a',
};

const SEARCH_OPTS = {
  decorations: {
    matchBackground: '#3a3a3a',
    matchOverviewRuler: '#888888',
    activeMatchBackground: '#7a6a1a',
    activeMatchColorOverviewRuler: '#ffd43b',
  },
};

// ─── Фонда сақталатын терминал сессиялары ───
// persistKey берілсе, компонент unmount болғанда (мысалы, беттің табы ауысқанда) xterm мен
// WebSocket жойылмайды — DOM-нан ажыратылып, осы кэште қалады. Shell-дегі процесс тоқтамай
// жұмысын жалғастырады, шығыс буферге жазыла береді; бетке оралғанда сол терминал қайта қосылады.

interface TermBind {
  optionsRef: React.MutableRefObject<UseTerminalOptions | undefined>;
  setStatus: (s: TerminalConnState) => void;
  setSession: (s: TerminalSessionInfo | null) => void;
  setError: (e: string | null) => void;
  setSearchResult: (r: TerminalSearchResult | null) => void;
}

interface TermEntry {
  /** persistKey — серверде де фонда жалғасады (бет жаңартылса да) */
  key: string | null;
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  /** xterm осы div-ке ашылады — оны контейнерлер арасында тасымалдаймыз */
  host: HTMLDivElement;
  ws: TerminalWebSocketService | null;
  input: { dispose: () => void } | null;
  subs: { dispose: () => void }[];
  activityId: string;
  getToken: () => Promise<string | null>;
  status: TerminalConnState;
  session: TerminalSessionInfo | null;
  error: string | null;
  searchResult: TerminalSearchResult | null;
  bind: TermBind;
  disposed: boolean;
}

const persisted = new Map<string, TermEntry>();

// Сервердегі сессия ID-і — бет жаңартылғанда (F5) сол shell-ге қайта қосылу үшін
const SID_PREFIX = 'codo-term-sid:';
const sidStore = {
  get: (key: string) => {
    try { return localStorage.getItem(SID_PREFIX + key); } catch { return null; }
  },
  set: (key: string, sid: string) => {
    try { localStorage.setItem(SID_PREFIX + key, sid); } catch { /* жеке терезе */ }
  },
  remove: (key: string) => {
    try { localStorage.removeItem(SID_PREFIX + key); } catch { /* жеке терезе */ }
  },
  /** keep-те жоқ кілттерді өшіру (keep болмаса — барлығын) */
  prune: (keep?: Set<string>) => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(SID_PREFIX) && !keep?.has(k.slice(SID_PREFIX.length))) localStorage.removeItem(k);
      }
    } catch { /* жеке терезе */ }
  },
};

const noop = () => {};

function destroyEntry(e: TermEntry) {
  if (e.disposed) return;
  e.disposed = true;
  e.input?.dispose();
  e.input = null;
  // Таб жабылды — сервердегі shell де тоқтасын (фонда қалмасын)
  e.ws?.close();
  e.ws = null;
  if (e.key) sidStore.remove(e.key);
  setTerminalConnected(e.activityId, false);
  e.subs.forEach(s => s.dispose());
  e.term.dispose();
  e.host.remove();
}

/** Терминал табы жабылды — сессиясын толық тоқтату */
export function disposeTerminalSession(key: string) {
  const e = persisted.get(key);
  if (!e) return;
  persisted.delete(key);
  destroyEntry(e);
}

/** Тізімде жоқ (жабылған) табтардың фондағы сессияларын тоқтату */
export function pruneTerminalSessions(keep: Iterable<string>) {
  const alive = new Set(keep);
  for (const key of [...persisted.keys()]) if (!alive.has(key)) disposeTerminalSession(key);
  sidStore.prune(alive);
}

/** Барлық фондағы сессияларды тоқтату (мысалы, аккаунттан шыққанда) */
export function disposeAllTerminalSessions() {
  for (const key of [...persisted.keys()]) disposeTerminalSession(key);
  sidStore.prune();
}

// Аккаунттан шыққанда фондағы shell-дер ескі аккаунттың атынан жұмыс істеп қалмасын
if (typeof window !== 'undefined') window.addEventListener('codo:logout', disposeAllTerminalSessions);

const emit = {
  status: (e: TermEntry, s: TerminalConnState) => { e.status = s; e.bind.setStatus(s); },
  session: (e: TermEntry, s: TerminalSessionInfo | null) => { e.session = s; e.bind.setSession(s); },
  error: (e: TermEntry, m: string | null) => { e.error = m; e.bind.setError(m); },
  search: (e: TermEntry, r: TerminalSearchResult | null) => { e.searchResult = r; e.bind.setSearchResult(r); },
};

function createEntry(bind: TermBind, key: string | null): TermEntry {
  const first = bind.optionsRef.current;
  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '100%';

  const term = new Terminal({
    theme: first?.theme === 'light' ? LIGHT_THEME : DARK_THEME,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    fontSize: first?.fontSize ?? 13,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    allowTransparency: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  const entry: TermEntry = {
    key, term, fitAddon, searchAddon, host,
    ws: null, input: null, subs: [],
    activityId: Math.random().toString(36).slice(2),
    getToken: async () => null,
    status: 'connecting', session: null, error: null, searchResult: null,
    bind, disposed: false,
  };
  // Callback-тер әрқашан ағымдағы иесінің (қайта қосылған компоненттің) опцияларын оқиды
  const cur = () => entry.bind.optionsRef.current;

  // URL-дер басылатын болады: жергілікті dev-сервер — сайттың көрініс панелінде,
  // қалғаны жаңа бетте (opener-сіз)
  term.loadAddon(new WebLinksAddon((_e, uri) => {
    const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s]*)?/.exec(uri);
    if (local) {
      const port = Number(local[1]);
      const info: DevServerInfo = {
        url: toBrowserUrl(port, local[2] || '/'),
        port,
        projectId: cur()?.projectId ?? null,
      };
      window.dispatchEvent(new CustomEvent<DevServerInfo>(DEV_SERVER_EVENT, { detail: info }));
      return;
    }
    window.open(uri, '_blank', 'noopener,noreferrer');
  }));
  term.open(host);

  entry.subs.push(searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
    emit.search(entry, { index: resultIndex, count: resultCount });
  }));

  // Жобаның файлдарына сілтеме: main.py:12 басылса — редакторда сол жол ашылады
  entry.subs.push(term.registerLinkProvider({
    provideLinks(y, callback) {
      const resolve = cur()?.resolveFile;
      const text = term.buffer.active.getLine(y - 1)?.translateToString(true);
      if (!resolve || !text) return callback(undefined);
      const taken: [number, number][] = [];
      for (const m of text.matchAll(URL_RE)) taken.push([m.index!, m.index! + m[0].length]);
      const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
      const links: ILink[] = [];
      const add = (start: number, len: number, rawPath: string, line: number, column: number) => {
        if (overlaps(start, start + len)) return;
        const path = resolve(rawPath);
        if (!path) return;
        taken.push([start, start + len]);
        links.push({
          range: { start: { x: start + 1, y }, end: { x: start + len, y } },
          text: text.slice(start, start + len),
          activate: () => cur()?.onOpenFile?.(path, line, column),
        });
      };
      for (const m of text.matchAll(PY_LINK_RE)) {
        add(m.index!, m[0].length, m[1], Number(m[2]), 1);
      }
      for (const m of text.matchAll(PATH_LINK_RE)) {
        add(m.index!, m[0].length, m[1], Number(m[2] ?? m[4] ?? 1), Number(m[3] ?? m[5] ?? 1));
      }
      callback(links.length ? links : undefined);
    },
  }));

  const shortcut = (e: KeyboardEvent, action: TerminalShortcut) => {
    e.preventDefault();
    cur()?.onShortcut?.(action);
    return false;
  };
  const copy = () => {
    if (!term.hasSelection()) return false;
    navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
    term.clearSelection();
    return true;
  };

  // Ctrl+C белгіленген мәтінде — көшіру (белгі болмаса shell-ге SIGINT кетеді),
  // Ctrl+V — қою. Ctrl+Shift+C/V — VS Code-тағыдай әрқашан көшіру/қою.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    // Табтар арасында ауысу. Браузер Ctrl+Tab-ты өзі ұстап алады (браузер табтары),
    // сондықтан негізгісі — Alt+→/← және Alt+1…5; Ctrl+Tab тек браузер жібергенде жұмыс істейді.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === 'ArrowRight') return shortcut(e, 'next-tab');
      if (e.key === 'ArrowLeft') return shortcut(e, 'prev-tab');
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) return shortcut(e, { tab: Number(digit[1]) });
    }
    if (e.ctrlKey && !e.altKey && e.key === 'Tab') return shortcut(e, e.shiftKey ? 'prev-tab' : 'next-tab');
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return true;
    const key = e.key.toLowerCase();
    if (e.shiftKey && key === 'c') {
      e.preventDefault();
      copy();
      return false;
    }
    if (e.shiftKey && key === 'v') {
      e.preventDefault();
      navigator.clipboard?.readText().then(text => { if (text) term.paste(text); }).catch(() => {});
      return false;
    }
    if (key === 'c' && copy()) return false;
    if (key === 'v') return false; // xterm paste оқиғасы өзі өңдейді
    if (key === 'j') return false; // Ctrl+J — панельді ашу/жабу (IDE деңгейінде)
    if (key === 'f') return shortcut(e, 'find');
    if (key === '=' || key === '+') return shortcut(e, 'zoom-in');
    if (key === '-' || key === '_') return shortcut(e, 'zoom-out');
    if (key === '0') return shortcut(e, 'zoom-reset');
    return true;
  });

  return entry;
}

export function useTerminal(options?: UseTerminalOptions): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const entryRef = useRef<TermEntry | null>(null);
  // Соңғы callback-тер — connect() қайта жасалмай-ақ жаңасын шақырады
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Фондағы сессияға қайта қосылдық па — онда бірінші connect() жаңа shell ашпайды
  const reattachedRef = useRef(false);

  // Фонда сақталған сессия болса — күйін сол жерден аламыз
  const [initial] = useState(() => (options?.persistKey ? persisted.get(options.persistKey) : undefined));
  const [searchResult, setSearchResult] = useState<TerminalSearchResult | null>(initial?.searchResult ?? null);
  // Терминал ашыла сала қосылады, сондықтан бастапқы күй — connecting
  // (әйтпесе бірінші кадрда «Қосылу» батырмасы жылт етеді)
  const [status, setStatus] = useState<TerminalConnState>(initial?.status ?? 'connecting');
  const isConnected = status === 'open';
  const [session, setSession] = useState<TerminalSessionInfo | null>(initial?.session ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);

  // Жасырын табта контейнердің өлшемі 0 — ол кезде fit жасамаймыз
  const fit = useCallback(() => {
    const el = containerRef.current;
    const e = entryRef.current;
    if (!el || !e || el.offsetWidth === 0 || el.offsetHeight === 0) return;
    try {
      e.fitAddon.fit();
      if (e.ws?.isConnected()) e.ws.resize(e.term.cols, e.term.rows);
    } catch { /* ignore fit errors during unmount */ }
  }, []);

  // Initialize terminal instance (немесе фондағысын қайта қосу)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const bind: TermBind = { optionsRef, setStatus, setSession, setError, setSearchResult };
    const key = optionsRef.current?.persistKey ?? null;
    const existing = key ? persisted.get(key) : undefined;
    let e: TermEntry;
    if (existing && !existing.disposed) {
      e = existing;
      e.bind = bind;
      reattachedRef.current = !!e.ws;
      // Ажыратулы кезде өзгерген күйді React-қа береміз
      setStatus(e.status);
      setSession(e.session);
      setError(e.error);
      setSearchResult(e.searchResult);
      const opts = optionsRef.current;
      e.term.options.theme = opts?.theme === 'light' ? LIGHT_THEME : DARK_THEME;
      if (opts?.fontSize) e.term.options.fontSize = opts.fontSize;
    } else {
      e = createEntry(bind, key);
      if (key) persisted.set(key, e);
    }
    container.appendChild(e.host);
    entryRef.current = e;
    e.term.refresh(0, e.term.rows - 1);

    // Small delay to ensure proper fit
    const timer = setTimeout(fit, 100);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(container);

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      entryRef.current = null;
      if (key && persisted.get(key) === e && !e.disposed) {
        // Фонда қалдырамыз: процесс жұмысын жалғастырады, React күйі енді жаңартылмайды.
        // Ескі компоненттің callback-терін ұстамаймыз — тек жоба id-сы (dev-сервер сілтемесі үшін) қалады.
        const projectId = optionsRef.current?.projectId ?? null;
        e.bind = {
          optionsRef: { current: { projectId } },
          setStatus: noop, setSession: noop, setError: noop, setSearchResult: noop,
        };
        e.host.remove();
        return;
      }
      destroyEntry(e);
    };
  }, [fit]);

  // Тақырып ауысса — терминалдың түстерін бірден жаңартамыз
  const termTheme = options?.theme;
  useEffect(() => {
    const term = entryRef.current?.term;
    if (!term) return;
    term.options.theme = termTheme === 'light' ? LIGHT_THEME : DARK_THEME;
  }, [termTheme]);

  // Шрифт өлшемі өзгерсе — жолдар/бағандар санын қайта есептейміз
  const fontSize = options?.fontSize;
  useEffect(() => {
    const term = entryRef.current?.term;
    if (!term || !fontSize || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    fit();
  }, [fontSize, fit]);

  const connect = useCallback((getToken: () => Promise<string | null>) => {
    const e = entryRef.current;
    if (!e) return;
    // Қайта қосылу әрқашан ең соңғы токен алушыны қолдансын
    e.getToken = getToken;
    if (reattachedRef.current) {
      // Фондағы shell әлі тірі — жаңасын ашпаймыз, бар сессияны жалғастырамыз
      reattachedRef.current = false;
      if (e.ws && e.status !== 'closed') return;
    }
    const term = e.term;
    const cur = () => e.bind.optionsRef.current;

    // Алдыңғы сессия болса — толық жабамыз
    e.input?.dispose();
    e.ws?.disconnect();

    const ws = new TerminalWebSocketService();

    // Codo терминалда не болып жатқанын көруі үшін шығыс пен оқиғалар vibeActivity-ге де барады
    ws.setOnOutput((data: string) => {
      term.write(data);
      appendTerminalOutput(data);
      if (ERROR_RE.test(data.replace(ANSI_RE, ''))) cur()?.onErrorOutput?.();
    });

    ws.setOnState((s) => emit.status(e, s));

    ws.setOnConnect((info) => {
      setTerminalConnected(e.activityId, true);
      if (e.key) sidStore.set(e.key, info.sessionId);
      // Фондағы shell-ге қайта қосылдық — сервер бұрынғы шығысты қайта жібереді,
      // қайталанбасын деп экранды тазалаймыз
      if (info.resumed) term.reset();
      emit.session(e, info);
      emit.error(e, null);
      if (info.mode === 'pipe') {
        term.writeln(`\x1b[33m! ${i18n.t('vibecoding.terminal.msg.pipeMode')}\x1b[0m`);
      }
      // Жоба папкасында ашылмады — ескертуді TerminalPanel жолақпен көрсетеді (xterm ішіне жазсақ,
      // shell іске қосылғанда экранды қайта салып, мәтінді бұзады)
      const wanted = cur()?.projectId ?? null;
      if (info.projectWarning || (wanted && !info.projectId)) {
        logEvent(`Терминал жоба папкасында ашылмады: ${info.projectWarning || 'projectNotFound'}`);
      }
      if (entryRef.current === e) fit();
      cur()?.onConnect?.(info);
    });

    ws.setOnDisconnect((willRetry) => {
      setTerminalConnected(e.activityId, false);
      term.writeln(`\r\n\x1b[90m— ${i18n.t(willRetry
        ? 'vibecoding.terminal.msg.reconnecting'
        : 'vibecoding.terminal.msg.disconnected')} —\x1b[0m`);
      cur()?.onDisconnect?.();
    });

    ws.setOnError((message: string) => {
      emit.error(e, message);
      logEvent(`Терминал қатесі: ${message}`);
      term.writeln(`\r\n\x1b[31m✗ ${message}\x1b[0m`);
      cur()?.onError?.(message);
    });

    ws.setOnExit((code: number) => {
      setTerminalConnected(e.activityId, false);
      if (e.key) sidStore.remove(e.key);
      logEvent(`Терминал процесі аяқталды (код: ${code})`);
      term.writeln(`\r\n\x1b[90m${i18n.t('vibecoding.terminal.msg.exited', { code })}\x1b[0m`);
    });

    ws.setOnFsChanges((projectId, changes) => {
      cur()?.onFsChanges?.(projectId, changes);
    });

    // Терминал енгізуі WebSocket-ке. Қатар жиналады — Enter басылғанда команда тарихына түседі.
    // Тілшелер/Tab (автотолтыру) болса, көрінген команданы біле алмаймыз — ондайда null.
    let line = '';
    let unsure = false;
    e.input = term.onData((data: string) => {
      trackTerminalInput(data);
      ws.sendInput(data);
      if (data.startsWith('\x1b')) {
        unsure = true;
        return;
      }
      for (const ch of data) {
        if (ch === '\r') {
          const cmd = line.trim();
          cur()?.onSubmit?.(!unsure && cmd ? cmd : null);
          line = '';
          unsure = false;
        } else if (ch === '\x7f' || ch === '\b') {
          line = line.slice(0, -1);
        } else if (ch === '\x03' || ch === '\x15') {
          line = ''; // Ctrl+C / Ctrl+U — қатар тазарады
          unsure = false;
        } else if (ch === '\t' || ch < ' ') {
          unsure = true;
        } else {
          line += ch;
        }
      }
    });

    e.ws = ws;
    void ws.connect(() => e.getToken(), {
      projectId: cur()?.projectId,
      codeId: cur()?.codeId,
      cols: term.cols,
      rows: term.rows,
      persist: !!e.key,
      resumeSessionId: e.key ? sidStore.get(e.key) : null,
    });
  }, [fit]);

  const disconnect = useCallback(() => {
    const e = entryRef.current;
    if (!e) return;
    e.input?.dispose();
    e.input = null;
    e.ws?.close();
    e.ws = null;
    if (e.key) sidStore.remove(e.key);
    emit.status(e, 'closed');
    setTerminalConnected(e.activityId, false);
    emit.session(e, null);
  }, []);

  const clear = useCallback(() => {
    entryRef.current?.term.clear();
  }, []);

  const focus = useCallback(() => {
    entryRef.current?.term.focus();
  }, []);

  const requestSync = useCallback(() => {
    entryRef.current?.ws?.requestSync();
  }, []);

  const sendText = useCallback((text: string) => {
    const term = entryRef.current?.term;
    if (!term) return;
    // Енгізу жолы арқылы — тарих пен Codo белсенділігі де жаңарады
    term.input(`${text}\r`);
    term.scrollToBottom();
    term.focus();
  }, []);

  const interrupt = useCallback(() => {
    entryRef.current?.term.input('\x03');
  }, []);

  const copySelection = useCallback(() => {
    const term = entryRef.current?.term;
    if (!term?.hasSelection()) return false;
    navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
    return true;
  }, []);

  const paste = useCallback(() => {
    const term = entryRef.current?.term;
    navigator.clipboard?.readText()
      .then(text => { if (text) term?.paste(text); })
      .catch(() => {});
    term?.focus();
  }, []);

  const selectAll = useCallback(() => {
    entryRef.current?.term.selectAll();
  }, []);

  const getSelection = useCallback(() => entryRef.current?.term.getSelection() ?? '', []);

  const getRecentText = useCallback((lines: number) => {
    const term = entryRef.current?.term;
    if (!term) return '';
    const buf = term.buffer.active;
    const out: string[] = [];
    // Соңғы бос жолдарды өткізіп, жоғары қарай оқимыз
    for (let y = buf.length - 1; y >= 0 && out.length < lines; y--) {
      const text = buf.getLine(y)?.translateToString(true) ?? '';
      if (!out.length && !text.trim()) continue;
      out.push(text);
    }
    return out.reverse().join('\n').trim();
  }, []);

  // incremental — теріп жатқанда ағымдағы сәйкестікте қалады (келесіге секірмейді)
  const findNext = useCallback((query: string, incremental = false) => (
    entryRef.current?.searchAddon.findNext(query, { ...SEARCH_OPTS, incremental }) ?? false
  ), []);

  const findPrevious = useCallback((query: string) => (
    entryRef.current?.searchAddon.findPrevious(query, SEARCH_OPTS) ?? false
  ), []);

  const clearSearch = useCallback(() => {
    const e = entryRef.current;
    if (!e) {
      setSearchResult(null);
      return;
    }
    e.searchAddon.clearDecorations();
    e.term.clearSelection();
    emit.search(e, null);
  }, []);

  return {
    terminalRef: containerRef,
    isConnected,
    status,
    session,
    error,
    connect,
    disconnect,
    clear,
    focus,
    fit,
    requestSync,
    sendText,
    interrupt,
    copySelection,
    paste,
    selectAll,
    getSelection,
    getRecentText,
    findNext,
    findPrevious,
    clearSearch,
    searchResult,
  };
}
