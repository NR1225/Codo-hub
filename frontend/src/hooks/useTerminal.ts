import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import TerminalWebSocketService, { TerminalSessionInfo } from '../utils/terminalWebSocket';
import type { WorkspaceChanges } from '../contexts/VibecodingContext';

export interface UseTerminalOptions {
  /** Терминал осы жобаның папкасында ашылады */
  projectId?: string | null;
  onConnect?: (info: TerminalSessionInfo) => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
  onFsChanges?: (projectId: string, changes: WorkspaceChanges) => void;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  isConnected: boolean;
  session: TerminalSessionInfo | null;
  error: string | null;
  connect: (token: string) => void;
  disconnect: () => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
  requestSync: () => void;
}

export function useTerminal(options?: UseTerminalOptions): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<TerminalWebSocketService | null>(null);
  const inputRef = useRef<{ dispose: () => void } | null>(null);
  // Соңғы callback-тер — connect() қайта жасалмай-ақ жаңасын шақырады
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [isConnected, setIsConnected] = useState(false);
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
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Ctrl+C белгіленген мәтінде — көшіру (белгі болмаса shell-ге SIGINT кетеді),
    // Ctrl+V — қою. Браузердің өз мінез-құлқымен бірдей.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'c' && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        return false;
      }
      if (key === 'v') return false; // xterm paste оқиғасы өзі өңдейді
      if (key === 'j') return false; // Ctrl+J — панельді ашу/жабу (IDE деңгейінде)
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
      inputRef.current?.dispose();
      inputRef.current = null;
      wsRef.current?.disconnect();
      wsRef.current = null;
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fit]);

  const connect = useCallback((token: string) => {
    const term = terminalRef.current;
    if (!term) return;

    // Алдыңғы сессия болса — толық жабамыз
    inputRef.current?.dispose();
    wsRef.current?.disconnect();

    const ws = new TerminalWebSocketService();

    ws.setOnOutput((data: string) => {
      terminalRef.current?.write(data);
    });

    ws.setOnConnect((info) => {
      setIsConnected(true);
      setSession(info);
      setError(null);
      if (info.mode === 'pipe') {
        terminalRef.current?.writeln('\x1b[33m! Қарапайым режим: серверде pywinpty жоқ, тек жолдық командалар жұмыс істейді\x1b[0m');
      }
      fit();
      optionsRef.current?.onConnect?.(info);
    });

    ws.setOnDisconnect(() => {
      setIsConnected(false);
      terminalRef.current?.writeln('\r\n\x1b[90m— терминал ажыратылды —\x1b[0m');
      optionsRef.current?.onDisconnect?.();
    });

    ws.setOnError((message: string) => {
      setError(message);
      terminalRef.current?.writeln(`\r\n\x1b[31m✗ ${message}\x1b[0m`);
      optionsRef.current?.onError?.(message);
    });

    ws.setOnExit((code: number) => {
      setIsConnected(false);
      terminalRef.current?.writeln(`\r\n\x1b[90mПроцесс аяқталды (код: ${code})\x1b[0m`);
    });

    ws.setOnFsChanges((projectId, changes) => {
      optionsRef.current?.onFsChanges?.(projectId, changes);
    });

    // Attach terminal input to WebSocket
    inputRef.current = term.onData((data: string) => {
      ws.sendInput(data);
    });

    wsRef.current = ws;
    ws.connect(token, {
      projectId: optionsRef.current?.projectId,
      cols: term.cols,
      rows: term.rows,
    });
  }, [fit]);

  const disconnect = useCallback(() => {
    inputRef.current?.dispose();
    inputRef.current = null;
    wsRef.current?.disconnect();
    wsRef.current = null;
    setIsConnected(false);
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

  return {
    terminalRef: containerRef,
    isConnected,
    session,
    error,
    connect,
    disconnect,
    clear,
    focus,
    fit,
    requestSync,
  };
}
