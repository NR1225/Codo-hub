/** WebSocket service for real-time messaging */
import { API_BASE_URL } from './constants';

type WebSocketMessageType =
  | 'new_message'
  | 'message_read'
  | 'messages_read'
  | 'typing'
  | 'pong';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  message?: any;
  messageId?: string;
  readAt?: string;
  userId?: string;
  count?: number;
  isTyping?: boolean;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private intentionalDisconnect = false;

  connect(userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.userId === userId) {
        resolve();
        return;
      }

      this.userId = userId;
      this.intentionalDisconnect = false;
      const wsUrl = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://');
      const url = `${wsUrl}/ws/${userId}`;

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.startPing();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.stopPing();
          if (!this.intentionalDisconnect) {
            this.attemptReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: WebSocketMessage) {
    // Emit to all listeners for this message type
    const listeners = this.listeners.get(data.type);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }

    // Also emit to 'all' listeners
    const allListeners = this.listeners.get('all');
    if (allListeners) {
      allListeners.forEach(listener => listener(data));
    }
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      if (this.userId) {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.connect(this.userId).catch(err => {
          console.error('Reconnection failed:', err);
        });
      }
    }, delay);
  }

  send(data: { type: string; [key: string]: any }) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  on(event: WebSocketMessageType | 'all', callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: WebSocketMessageType | 'all', callback: (data: any) => void) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  markDelivered(messageId: string) {
    this.send({ type: 'mark_delivered', messageId });
  }

  sendTyping(recipientId: string, isTyping: boolean) {
    this.send({ type: 'typing', recipientId, isTyping });
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.userId = null;
    // Don't clear listeners - components manage their own subscriptions via on/off
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const websocketService = new WebSocketService();

