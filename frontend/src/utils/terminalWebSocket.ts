import { API_BASE_URL } from './constants';
import i18n from '../i18n/config';
import type { WorkspaceChanges } from '../contexts/VibecodingContext';
import { DevServerDetector } from './devServer';

type MessageType =
  | 'auth' | 'input' | 'resize' | 'ping' | 'sync' | 'output' | 'connected' | 'disconnected'
  | 'exit' | 'error' | 'pong' | 'fs-changes';

interface TerminalMessage extends Partial<WorkspaceChanges> {
  type: MessageType;
  data?: string;
  cols?: number;
  rows?: number;
  sessionId?: string;
  projectId?: string | null;
  mode?: string;
  platform?: string;
  code?: number | string;
  message?: string;
}

export interface TerminalSessionInfo {
  sessionId: string;
  /** Терминал ашылған жоба (null — жоба табылмаса, үй папкасында) */
  projectId: string | null;
  /** conpty / pty — нағыз терминал, pipe — қарапайым режим */
  mode: string;
  platform: string;
}

/** connecting — қосылып/қайта қосылып жатыр, open — shell дайын, closed — тоқтады */
export type TerminalConnState = 'connecting' | 'open' | 'closed';

export interface TerminalConnectOptions {
  projectId?: string | null;
  /** Жүктелген жоба (кодты көру беті) — оның көшірмесінде ашылады */
  codeId?: string | null;
  cols?: number;
  rows?: number;
}

class TerminalWebSocketService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  // 1+2+...+8 с ≈ 36 с — сервер қайта іске қосылғанша күтуге жетеді
  private maxReconnectAttempts = 8;
  private reconnectDelay = 1000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private onOutput: ((data: string) => void) | null = null;
  private onDisconnect: ((willRetry: boolean) => void) | null = null;
  private onState: ((state: TerminalConnState) => void) | null = null;
  private onConnect: ((info: TerminalSessionInfo) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private onExit: ((code: number) => void) | null = null;
  private onFsChanges: ((projectId: string, changes: WorkspaceChanges) => void) | null = null;
  private shouldReconnect = true;
  private projectId: string | null = null;
  // `npm run dev` сияқты командалар басып шығарған адресті preview панеліне береді
  private devServer = new DevServerDetector(() => this.projectId);

  /**
   * Әр қосылу (қайта қосылу да) алдында жаңа токен сұраймыз — access-токен 30 минутта ескіреді,
   * ал ескі токенмен сервер қосылуды үнсіз қабылдамайды.
   */
  async connect(getToken: () => Promise<string | null>, options: TerminalConnectOptions = {}): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;
    this.onState?.('connecting');
    let token: string | null = null;
    try {
      token = await getToken();
    } catch { /* төменде қате ретінде көрсетіледі */ }
    if (!this.shouldReconnect) return; // күткен кезде ажыратылды
    if (!token) {
      this.onState?.('closed');
      if (this.onError) this.onError(i18n.t('vibecoding.terminal.msg.loginRequired'));
      return;
    }
    const wsBaseUrl = API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '');
    // Токен URL-де емес, бірінші хабарда жіберіледі — сервер/прокси логтарына түспейді
    const params = new URLSearchParams();
    if (options.projectId) params.set('projectId', options.projectId);
    if (options.codeId) params.set('codeId', options.codeId);
    if (options.cols) params.set('cols', String(options.cols));
    if (options.rows) params.set('rows', String(options.rows));
    // Сайт тілі — сервер shell-дің хабар тілін (locale) соған қояды
    params.set('lang', i18n.resolvedLanguage || i18n.language || 'kk');
    const url = `${wsBaseUrl}/api/ws/terminal?${params.toString()}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.send({ type: 'auth', token });
        this.reconnectAttempts = 0;
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: TerminalMessage = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch {
          // Binary data from terminal
          if (this.onOutput) {
            this.onOutput(event.data);
          }
        }
      };

      this.ws.onclose = (event) => {
        this.stopPing();
        // Шектеу/рұқсат қателерінде (4001, 4003, 4004, 4008) қайта қосылудың мәні жоқ
        const fatal = event.code >= 4000 && event.code < 4100;
        const willRetry = !fatal && this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts;
        this.devServer.stop(); // сессия жабылды — оның процестері де (dev-сервер) тоқтады
        if (this.onDisconnect) this.onDisconnect(willRetry);
        this.onState?.(willRetry ? 'connecting' : 'closed');
        if (event.code === 4001 && this.onError) this.onError(i18n.t('vibecoding.terminal.msg.loginRequired'));
        if (event.code === 4004 && this.onError) this.onError(i18n.t('vibecoding.terminal.msg.disabled'));
        if (willRetry) {
          this.reconnectAttempts++;
          setTimeout(() => {
            if (this.shouldReconnect) void this.connect(getToken, options);
          }, this.reconnectDelay * this.reconnectAttempts);
        }
      };

      this.ws.onerror = () => {
        // Қайта қосылу әлі жалғасып жатса — қатені көрсетпейміз (onclose өзі қайталайды)
        if (this.reconnectAttempts < this.maxReconnectAttempts) return;
        if (this.onError) this.onError(i18n.t('vibecoding.terminal.msg.socketError'));
      };
    } catch (err) {
      this.onState?.('closed');
      if (this.onError) this.onError(i18n.t('vibecoding.terminal.msg.connectFailed'));
    }
  }

  private handleMessage(msg: TerminalMessage): void {
    switch (msg.type) {
      case 'connected':
        this.sessionId = msg.sessionId || null;
        this.projectId = msg.projectId ?? null;
        this.devServer.reset();
        this.onState?.('open');
        if (this.onConnect && msg.sessionId) {
          this.onConnect({
            sessionId: msg.sessionId,
            projectId: msg.projectId ?? null,
            mode: msg.mode || 'pty',
            platform: msg.platform || '',
          });
        }
        break;
      case 'output':
        if (msg.data) {
          this.devServer.feed(msg.data);
          this.onOutput?.(msg.data);
        }
        break;
      case 'fs-changes':
        if (this.onFsChanges && msg.projectId) {
          this.onFsChanges(msg.projectId, {
            upserts: msg.upserts ?? [],
            deletes: msg.deletes ?? [],
            folders: msg.folders ?? [],
            deletedFolders: msg.deletedFolders ?? [],
          });
        }
        break;
      case 'pong':
        break;
      case 'exit':
        if (this.onExit && typeof msg.code === 'number') {
          this.onExit(msg.code);
        }
        this.shouldReconnect = false;
        this.onState?.('closed');
        break;
      case 'error':
        // Сервер қате кодын жібереді — мәтінді сайт тілінде көрсетеміз
        if (this.onError) {
          const key = typeof msg.code === 'string' ? `vibecoding.terminal.msg.${msg.code}` : '';
          this.onError(key && i18n.exists(key)
            ? i18n.t(key)
            : msg.message || i18n.t('vibecoding.terminal.msg.unknownError'));
        }
        break;
      case 'disconnected':
        if (this.onDisconnect) this.onDisconnect(false);
        break;
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendInput(data: string): void {
    this.send({ type: 'input', data });
  }

  resize(cols: number, rows: number): void {
    this.send({ type: 'resize', cols, rows });
  }

  /** Жоба папкасындағы өзгерістерді қазір сұрау */
  requestSync(): void {
    this.send({ type: 'sync' });
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => this.send({ type: 'ping' }), 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();
    this.devServer.stop();
    if (this.ws) {
      // Ескі сокеттің кеш келетін onclose-ы жаңа сессияның күйін бұзбасын
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
  }

  setOnOutput(callback: (data: string) => void): void {
    this.onOutput = callback;
  }
  setOnDisconnect(callback: (willRetry: boolean) => void): void {
    this.onDisconnect = callback;
  }
  setOnState(callback: (state: TerminalConnState) => void): void {
    this.onState = callback;
  }
  setOnConnect(callback: (info: TerminalSessionInfo) => void): void {
    this.onConnect = callback;
  }
  setOnError(callback: (message: string) => void): void {
    this.onError = callback;
  }
  setOnExit(callback: (code: number) => void): void {
    this.onExit = callback;
  }
  setOnFsChanges(callback: (projectId: string, changes: WorkspaceChanges) => void): void {
    this.onFsChanges = callback;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}

export default TerminalWebSocketService;
