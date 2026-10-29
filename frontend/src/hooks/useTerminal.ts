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

const SEARCH_OPTS = {
  decorations: {
    matchBackground: '#3a3a3a',
    matchOverviewRuler: '#888888',
    activeMatchBackground: '#7a6a1a',
    activeMatchColorOverviewRuler: '#ffd43b',
  },
};

export function useTerminal(options?: UseTerminalOptions): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchResult, setSearchResult] = useState<TerminalSearchResult | null>(null);
  const wsRef = useRef<TerminalWebSocketService | null>(null);
  const inputRef = useRef<{ dispose: () => void } | null>(null);
  const tabIdRef = useRef(Math.random().toString(36).slice(2));
  // Соңғы callback-тер — connect() қайта жасалмай-ақ жаңасын шақырады
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Терминал ашыла сала қосылады, сондықтан бастапқы күй — connecting
  // (әйтпесе бірінші кадрда «Қосылу» батырмасы жылт етеді)
  const [status, setStatus] = useState<TerminalConnState>('connecting');
  const isConnected = status === 'open';
  const [session, setSession] = useState<TerminalSessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Жасырын табта контейнердің өлшемі 0 — ол кезде fit жасамаймыз
  const fit = useCallback(() => {
    const el = containerRef.current;
    const term = terminalRef.current;
    if (!el || !term || !fitAddonRef.current || el.offsetWidth === 0 || el.offsetHeight === 0) return;
    try {
      fitAddonRef.current.fit();
      const ws = wsRef.current;
      if (ws?.isConnected()) ws.resize(term.cols, term.rows);
    } catch { /* ignore fit errors during unmount */ }
  }, []);

  // Initialize terminal instance
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        // Vibecoding бетінің қара монохром палитрасы
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
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      fontSize: optionsRef.current?.fontSize ?? 13,
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
    // URL-дер басылатын болады: жергілікті dev-сервер — сайттың көрініс панелінде,
    // қалғаны жаңа бетте (opener-сіз)
    term.loadAddon(new WebLinksAddon((_e, uri) => {
      const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s]*)?/.exec(uri);
      if (local) {
        const port = Number(local[1]);
        const info: DevServerInfo = {
          url: toBrowserUrl(port, local[2] || '/'),
          port,
          projectId: optionsRef.current?.projectId ?? null,
        };
        window.dispatchEvent(new CustomEvent<DevServerInfo>(DEV_SERVER_EVENT, { detail: info }));
        return;
      }
      window.open(uri, '_blank', 'noopener,noreferrer');
    }));
    term.open(containerRef.current);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    const searchSub = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResult({ index: resultIndex, count: resultCount });
    });

    // Жобаның файлдарына сілтеме: main.py:12 басылса — редакторда сол жол ашылады
    const linkSub = term.registerLinkProvider({
      provideLinks(y, callback) {
        const resolve = optionsRef.current?.resolveFile;
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
            activate: () => optionsRef.current?.onOpenFile?.(path, line, column),
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
    });

    const shortcut = (e: KeyboardEvent, action: TerminalShortcut) => {
      e.preventDefault();
      optionsRef.current?.onShortcut?.(action);
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

    // Small delay to ensure proper fit
    const timer = setTimeout(fit, 100);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      searchSub.dispose();
      linkSub.dispose();
      inputRef.current?.dispose();
      inputRef.current = null;
      wsRef.current?.disconnect();
      wsRef.current = null;
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [fit]);

  // Шрифт өлшемі өзгерсе — жолдар/бағандар санын қайта есептейміз
  const fontSize = options?.fontSize;
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !fontSize || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    fit();
  }, [fontSize, fit]);

  const connect = useCallback((getToken: () => Promise<string | null>) => {
    const term = terminalRef.current;
    if (!term) return;

    // Алдыңғы сессия болса — толық жабамыз
    inputRef.current?.dispose();
    wsRef.current?.disconnect();

    const ws = new TerminalWebSocketService();

    // Бүркіт терминалда не болып жатқанын көруі үшін шығыс пен оқиғалар vibeActivity-ге де барады
    ws.setOnOutput((data: string) => {
      terminalRef.current?.write(data);
      appendTerminalOutput(data);
      if (ERROR_RE.test(data.replace(ANSI_RE, ''))) optionsRef.current?.onErrorOutput?.();
    });

    ws.setOnState(setStatus);

    ws.setOnConnect((info) => {
      setTerminalConnected(tabIdRef.current, true);
      setSession(info);
      setError(null);
      if (info.mode === 'pipe') {
        terminalRef.current?.writeln(`\x1b[33m! ${i18n.t('vibecoding.terminal.msg.pipeMode')}\x1b[0m`);
      }
      fit();
      optionsRef.current?.onConnect?.(info);
    });

    ws.setOnDisconnect((willRetry) => {
      setTerminalConnected(tabIdRef.current, false);
      terminalRef.current?.writeln(`\r\n\x1b[90m— ${i18n.t(willRetry
        ? 'vibecoding.terminal.msg.reconnecting'
        : 'vibecoding.terminal.msg.disconnected')} —\x1b[0m`);
      optionsRef.current?.onDisconnect?.();
    });

    ws.setOnError((message: string) => {
      setError(message);
      logEvent(`Терминал қатесі: ${message}`);
      terminalRef.current?.writeln(`\r\n\x1b[31m✗ ${message}\x1b[0m`);
      optionsRef.current?.onError?.(message);
    });

    ws.setOnExit((code: number) => {
      setTerminalConnected(tabIdRef.current, false);
      logEvent(`Терминал процесі аяқталды (код: ${code})`);
      terminalRef.current?.writeln(`\r\n\x1b[90m${i18n.t('vibecoding.terminal.msg.exited', { code })}\x1b[0m`);
    });

    ws.setOnFsChanges((projectId, changes) => {
      optionsRef.current?.onFsChanges?.(projectId, changes);
    });

    // Терминал енгізуі WebSocket-ке. Қатар жиналады — Enter басылғанда команда тарихына түседі.
    // Тілшелер/Tab (автотолтыру) болса, көрінген команданы біле алмаймыз — ондайда null.
    let line = '';
    let unsure = false;
    inputRef.current = term.onData((data: string) => {
      trackTerminalInput(data);
      ws.sendInput(data);
      if (data.startsWith('\x1b')) {
        unsure = true;
        return;
      }
      for (const ch of data) {
        if (ch === '\r') {
          const cmd = line.trim();
          optionsRef.current?.onSubmit?.(!unsure && cmd ? cmd : null);
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

    wsRef.current = ws;
    void ws.connect(getToken, {
      projectId: optionsRef.current?.projectId,
      codeId: optionsRef.current?.codeId,
      cols: term.cols,
      rows: term.rows,
    });
  }, [fit]);

  const disconnect = useCallback(() => {
    inputRef.current?.dispose();
    inputRef.current = null;
    wsRef.current?.disconnect();
    wsRef.current = null;
    setStatus('closed');
    setTerminalConnected(tabIdRef.current, false);
    setSession(null);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const requestSync = useCallback(() => {
    wsRef.current?.requestSync();
  }, []);

  const sendText = useCallback((text: string) => {
    const term = terminalRef.current;
    if (!term) return;
    // Енгізу жолы арқылы — тарих пен Бүркіт белсенділігі де жаңарады
    term.input(`${text}\r`);
    term.scrollToBottom();
    term.focus();
  }, []);

  const copySelection = useCallback(() => {
    const term = terminalRef.current;
    if (!term?.hasSelection()) return false;
    navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
    return true;
  }, []);

  const paste = useCallback(() => {
    navigator.clipboard?.readText()
      .then(text => { if (text) terminalRef.current?.paste(text); })
      .catch(() => {});
    terminalRef.current?.focus();
  }, []);

  const selectAll = useCallback(() => {
    terminalRef.current?.selectAll();
  }, []);

  const getSelection = useCallback(() => terminalRef.current?.getSelection() ?? '', []);

  const getRecentText = useCallback((lines: number) => {
    const term = terminalRef.current;
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
    searchAddonRef.current?.findNext(query, { ...SEARCH_OPTS, incremental }) ?? false
  ), []);

  const findPrevious = useCallback((query: string) => (
    searchAddonRef.current?.findPrevious(query, SEARCH_OPTS) ?? false
  ), []);

  const clearSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.clearSelection();
    setSearchResult(null);
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
