import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import TerminalWebSocketService from '../utils/terminalWebSocket';

interface UseTerminalOptions {
  onConnect?: (sessionId: string) => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  isConnected: boolean;
  sessionId: string | null;
  error: string | null;
  connect: (token: string) => void;
  disconnect: () => void;
  clear: () => void;
}

export function useTerminal(options?: UseTerminalOptions): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<TerminalWebSocketService | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    // Small delay to ensure proper fit
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Write welcome message
    term.writeln('\x1b[36m╔══════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[36m║     \x1b[33m🚀 Vibecoding Terminal\x1b[36m            ║\x1b[0m');
    term.writeln('\x1b[36m╚══════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.writeln('\x1b[33mТерминалға қосылу үшін «Қосылу» батырмасын басыңыз.\x1b[0m');
    term.writeln('');

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
          const ws = wsRef.current;
          if (ws?.isConnected()) {
            ws.resize(terminalRef.current.cols, terminalRef.current.rows);
          }
        } catch { /* ignore fit errors during unmount */ }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const connect = useCallback((token: string) => {
    if (!terminalRef.current) return;

    const ws = new TerminalWebSocketService();

    ws.setOnOutput((data: string) => {
      if (terminalRef.current) {
        terminalRef.current.write(data);
      }
    });

    ws.setOnConnect((id: string) => {
      setIsConnected(true);
      setSessionId(id);
      setError(null);
      if (terminalRef.current) {
        terminalRef.current.writeln('');
        terminalRef.current.writeln('\x1b[32m✓ Терминалға қосылды\x1b[0m');
        terminalRef.current.writeln('');
        // Resize terminal to match session
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          ws.resize(terminalRef.current.cols, terminalRef.current.rows);
        }
      }
      options?.onConnect?.(id);
    });

    ws.setOnDisconnect(() => {
      setIsConnected(false);
      if (terminalRef.current) {
        terminalRef.current.writeln('');
        terminalRef.current.writeln('\x1b[33m⚡ Терминал ажыратылды\x1b[0m');
      }
      options?.onDisconnect?.();
    });

    ws.setOnError((message: string) => {
      setError(message);
      if (terminalRef.current) {
        terminalRef.current.writeln(`\x1b[31m✗ Қате: ${message}\x1b[0m`);
      }
      options?.onError?.(message);
    });

    ws.setOnExit((code: number) => {
      setIsConnected(false);
      if (terminalRef.current) {
        terminalRef.current.writeln(`\x1b[33mПроцесс аяқталды (код: ${code})\x1b[0m`);
      }
    });

    // Attach terminal input to WebSocket
    const inputDisposable = terminalRef.current.onData((data: string) => {
      ws.sendInput(data);
    });

    wsRef.current = ws;
    ws.connect(token);

    // Store disposable for cleanup
    return () => {
      inputDisposable.dispose();
      ws.disconnect();
    };
  }, [options]);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
    wsRef.current = null;
    setIsConnected(false);
    setSessionId(null);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  return {
    terminalRef: containerRef,
    isConnected,
    sessionId,
    error,
    connect,
    disconnect,
    clear,
  };
}