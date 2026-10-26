import { API_BASE_URL } from './constants';
import type { WorkspaceChanges } from '../contexts/VibecodingContext';

type MessageType =
  | 'input' | 'resize' | 'ping' | 'sync' | 'output' | 'connected' | 'disconnected'
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
  code?: number;
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

export interface TerminalConnectOptions {
  projectId?: string | null;
  cols?: number;
  rows?: number;
}

class TerminalWebSocketService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private onOutput: ((data: string) => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private onConnect: ((info: TerminalSessionInfo) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private onExit: ((code: number) => void) | null = null;
  private onFsChanges: ((projectId: string, changes: WorkspaceChanges) => void) | null = null;
  private shouldReconnect = true;

  connect(token: string, options: TerminalConnectOptions = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;
    const wsBaseUrl = API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '');
    const params = new URLSearchParams({ token });
    if (options.projectId) params.set('projectId', options.projectId);
    if (options.cols) params.set('cols', String(options.cols));
    if (options.rows) params.set('rows', String(options.rows));
    const url = `${wsBaseUrl}/api/ws/terminal?${params.toString()}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
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
        if (this.onDisconnect) this.onDisconnect();
        // Шектеу/рұқсат қателерінде (4001, 4003, 4004, 4008) қайта қосылудың мәні жоқ
        const fatal = event.code >= 4000 && event.code < 4100;
        if (!fatal && this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => {
            if (this.shouldReconnect) this.connect(token, options);
          }, this.reconnectDelay * this.reconnectAttempts);
        }
      };

      this.ws.onerror = () => {
        if (this.onError) this.onError('WebSocket қосылу қатесі');
      };
    } catch (err) {
      if (this.onError) this.onError('Терминал қосылу сәтсіз');
    }
  }

  private handleMessage(msg: TerminalMessage): void {
    switch (msg.type) {
      case 'connected':
        this.sessionId = msg.sessionId || null;
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
        if (this.onOutput && msg.data) {
          this.onOutput(msg.data);
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
        if (this.onExit && msg.code !== undefined) {
          this.onExit(msg.code);
        }
        this.shouldReconnect = false;
        break;
      case 'error':
        if (this.onError) this.onError(msg.message || 'Белгісіз қате');
        break;
      case 'disconnected':
        if (this.onDisconnect) this.onDisconnect();
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
  }

  setOnOutput(callback: (data: string) => void): void {
    this.onOutput = callback;
  }
  setOnDisconnect(callback: () => void): void {
    this.onDisconnect = callback;
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
