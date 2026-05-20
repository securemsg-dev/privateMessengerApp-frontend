/**
 * services/userSocket.ts
 * ───────────────────────
 * Global per-user signaling WebSocket (Phase E). Distinct from ChatSocket
 * (per-conversation): this one is opened ONCE on auth and stays alive for
 * the whole session so the server can push call signaling — and any future
 * "addressed to this user" event — to whichever screen the user is on.
 *
 * Inbound + outbound wire format mirrors backend/app/websocket/user_router.py.
 *
 * Lifecycle / reconnect behaviour matches ChatSocket: exponential backoff
 * (1s → 30s), one-shot token refresh on WS_1008_POLICY_VIOLATION, send()
 * queues until the socket is open.
 */

import * as SecureStore from '../utils/secureStorage';
import {
  buildUserWebSocketUrl,
  refreshApi,
  REFRESH_TOKEN_KEY,
  TOKEN_KEY,
} from './api';

// ── Wire types ───────────────────────────────────────────────────────────────

interface BaseSignalingFromMe {
  to_user_id: string;
  conversation_id: string;
  call_id: string;
}

interface BaseSignalingToMe {
  from_user_id: string;
  conversation_id: string;
  call_id: string;
}

export interface ClientCallOffer extends BaseSignalingFromMe {
  type: 'call_offer';
  sdp: string;
}
export interface ClientCallAnswer extends BaseSignalingFromMe {
  type: 'call_answer';
  sdp: string;
}
export interface ClientCallIce extends BaseSignalingFromMe {
  type: 'call_ice';
  candidate: object; // serialised RTCIceCandidate
}
export interface ClientCallEnd extends BaseSignalingFromMe {
  type: 'call_end';
  reason: 'completed' | 'declined' | 'cancelled' | 'failed';
}

export type UserClientEvent =
  | ClientCallOffer
  | ClientCallAnswer
  | ClientCallIce
  | ClientCallEnd;

export interface ServerCallOffer extends BaseSignalingToMe {
  type: 'call_offer';
  sdp: string;
}
export interface ServerCallAnswer extends BaseSignalingToMe {
  type: 'call_answer';
  sdp: string;
}
export interface ServerCallIce extends BaseSignalingToMe {
  type: 'call_ice';
  candidate: object;
}
export interface ServerCallEnd extends BaseSignalingToMe {
  type: 'call_end';
  reason: 'completed' | 'declined' | 'cancelled' | 'failed';
}
export interface ServerError {
  type: 'error';
  detail: string;
}

export type UserServerEvent =
  | ServerCallOffer
  | ServerCallAnswer
  | ServerCallIce
  | ServerCallEnd
  | ServerError;

// ── Connection management ────────────────────────────────────────────────────

export type UserSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

type Listener = (e: UserServerEvent) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const POLICY_VIOLATION = 1008;

export class UserSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private state: UserSocketState = 'idle';
  private outboundQueue: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;
  private refreshAttempted = false;

  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'open') return;
    this.explicitlyClosed = false;
    await this.openSocket();
  }

  send(event: UserClientEvent): void {
    const data = JSON.stringify(event);
    if (this.ws && this.state === 'open') {
      this.ws.send(data);
    } else {
      this.outboundQueue.push(data);
    }
  }

  onEvent(handler: Listener): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  close(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.state = 'closed';
    this.listeners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async openSocket(): Promise<void> {
    this.state = 'connecting';
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) {
      this.state = 'error';
      this.scheduleReconnect();
      return;
    }
    const url = buildUserWebSocketUrl(token);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.state = 'error';
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.refreshAttempted = false;
      this.state = 'open';
      while (this.outboundQueue.length > 0) {
        const next = this.outboundQueue.shift();
        if (next !== undefined) ws.send(next);
      }
    };

    ws.onmessage = (e: WebSocketMessageEvent) => {
      let parsed: UserServerEvent;
      try {
        parsed = JSON.parse(String(e.data)) as UserServerEvent;
      } catch {
        return;
      }
      for (const l of this.listeners) {
        try {
          l(parsed);
        } catch (err) {
          console.warn('[UserSocket] listener threw', err);
        }
      }
    };

    ws.onerror = () => {
      this.state = 'error';
    };

    ws.onclose = (ev: WebSocketCloseEvent) => {
      this.ws = null;
      this.state = 'closed';
      if (this.explicitlyClosed) return;
      if (ev.code === POLICY_VIOLATION && !this.refreshAttempted) {
        this.refreshAttempted = true;
        void this.tryRefreshThenReconnect();
        return;
      }
      this.scheduleReconnect();
    };
  }

  private async tryRefreshThenReconnect(): Promise<void> {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        this.scheduleReconnect();
        return;
      }
      const tokens = await refreshApi(refreshToken);
      await SecureStore.setItemAsync(TOKEN_KEY, tokens.access_token);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh_token);
      void this.openSocket();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.explicitlyClosed) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delay);
  }
}
