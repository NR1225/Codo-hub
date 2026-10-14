import { API_BASE_URL } from './constants';

type MessageType = 'input' | 'resize' | 'ping' | 'output' | 'connected' | 'disconnected' | 'exit' | 'error' | 'pong';

interface TerminalMessage {
  type: MessageType;
  data?: string;
  cols?: number;
  rows?: number;
  sessionId?: string;
  code?: number;
  message?: string;
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
  private onConnect: ((sessionId: string) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private onExit: ((code: number) => void) | null = null;
  private shouldReconnect = true;

  connect(token: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;
    const wsBaseUrl = API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '');
    const url = `${wsBaseUrl}/api/ws/terminal?token=${encodeURIComponent(token)}`;

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

      this.ws.onclose = () => {
        this.stopPing();
        if (this.onDisconnect) this.onDisconnect();
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(token), this.reconnectDelay * this.reconnectAttempts);
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
          this.onConnect(msg.sessionId);
        }
        break;
      case 'output':
        if (this.onOutput && msg.data) {
          this.onOutput(msg.data);
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

  sendInput(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  resize(cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
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
  setOnConnect(callback: (sessionId: string) => void): void {
    this.onConnect = callback;
  }
  setOnError(callback: (message: string) => void): void {
    this.onError = callback;
  }
  setOnExit(callback: (code: number) => void): void {
    this.onExit = callback;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}

export default TerminalWebSocketService;