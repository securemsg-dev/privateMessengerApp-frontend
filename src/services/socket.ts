/**
 * services/socket.ts
 * ───────────────────
 * Per-conversation WebSocket client with:
 *   - JWT auth via query parameter (matches backend /ws/{conv_id}?token=…)
 *   - Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, … capped 30s)
 *   - On WS_1008_POLICY_VIOLATION (typically expired token): refresh tokens
 *     once and reconnect before falling back to plain backoff
 *   - Outbound message queue: send() before connect resolves stays buffered
 *
 * Wire format mirrors backend/app/websocket/router.py — see the module
 * docstring there for the canonical schema.
 */

import * as SecureStore from '../utils/secureStorage';
import {
  buildWebSocketUrl,
  refreshTokensSingleFlight,
  TOKEN_KEY,
} from './api';

// ── Wire types — server → client ─────────────────────────────────────────────

export interface ServerMessageEvent {
  type: 'message';
  conversation_id: string;
  sender_id: string;
  message_id: string;
  client_temp_id?: string | null;
  encrypted_payload: string;
  message_type: 'text' | 'voice' | 'image' | 'document' | 'video' | 'system';
  self_destruct: boolean;
  reply_to_id?: string | null;
  timestamp: string;
  /** Groups: who sent it and the key that decrypts it. */
  sender_display_name?: string | null;
  sender_public_key?: string | null;
}

export interface ServerReceiptEvent {
  type: 'delivery' | 'read';
  conversation_id: string;
  /** First acknowledged id (legacy single-receipt field). */
  message_id: string;
  /** Full batch of acknowledged ids — always present on new servers. */
  message_ids?: string[];
  by_user_id: string;
  timestamp: string;
}

export interface ServerReactionEvent {
  type: 'reaction';
  conversation_id: string;
  message_id: string;
  emoji: string;
  by_user_id: string;
  action: 'added' | 'removed';
}

/** Broadcast when a message is deleted for everyone (Phase C.3). */
export interface ServerDeletionEvent {
  type: 'deletion';
  conversation_id: string;
  message_id: string;
  by_user_id: string;
  timestamp: string;
}

export interface ServerErrorEvent {
  type: 'error';
  detail: string;
  /** Machine-readable reason, e.g. 'group_members_changed', 'not_a_member'. */
  code?: string;
  /** Set when the error is about one specific outgoing message. */
  client_temp_id?: string;
}

/** Group membership / name changed — refetch the conversation. */
export interface ServerGroupUpdateEvent {
  type: 'group_update';
  conversation_id: string;
}

/**
 * Synthetic (client-side) event: the server closed this socket with 4403 —
 * we're no longer a member (removed from the group, or it was deleted).
 */
export interface AccessRevokedEvent {
  type: 'access_revoked';
  conversation_id: string;
}

/** Peer online / last seen (only sent to sockets opened with presence=1). */
export interface ServerPresenceEvent {
  type: 'presence';
  user_id: string;
  online: boolean;
  /** ISO timestamp; null when unknown or the peer hides their status. */
  last_seen: string | null;
}

export type ServerEvent =
  | ServerMessageEvent
  | ServerReceiptEvent
  | ServerReactionEvent
  | ServerDeletionEvent
  | ServerErrorEvent
  | ServerPresenceEvent
  | ServerGroupUpdateEvent
  | AccessRevokedEvent;

// ── Wire types — client → server ─────────────────────────────────────────────

export interface ClientMessageEvent {
  type: 'message';
  encrypted_payload: string;
  message_type: 'text' | 'voice' | 'image' | 'document' | 'video';
  self_destruct?: boolean;
  client_temp_id?: string;
  reply_to_id?: string;
  /**
   * Plaintext blob id for media messages. Used server-side ONLY for storage
   * lifecycle (deleting the ciphertext file on delete-for-everyone / account
   * deletion) — the content stays E2EE inside encrypted_payload.
   */
  media_blob_id?: string;
}

export interface ClientReceiptEvent {
  type: 'delivery' | 'read';
  /** Batched ids — one frame acks a whole page without tripping the server's
   *  per-connection throttle. `message_id` (single) is also accepted. */
  message_ids?: string[];
  message_id?: string;
}

export interface ClientReactionEvent {
  type: 'reaction';
  message_id: string;
  emoji: string;
}

export type ClientEvent =
  | ClientMessageEvent
  | ClientReceiptEvent
  | ClientReactionEvent;

// ── Connection state ─────────────────────────────────────────────────────────

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

type Listener = (e: ServerEvent) => void;
type StateListener = (state: ConnectionState) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const POLICY_VIOLATION = 1008;
/** Not (or no longer) a member — final, never reconnect. */
const ACCESS_REVOKED = 4403;

export class ChatSocket {
  private ws: WebSocket | null = null;
  private readonly conversationId: string;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private state: ConnectionState = 'idle';
  private outboundQueue: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;
  // Guard so we only attempt token refresh once per close cycle. Reset on a
  // successful 'open'.
  private refreshAttempted = false;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'open') return;
    this.explicitlyClosed = false;
    await this.openSocket();
  }

  send(event: ClientEvent): void {
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

  onState(handler: StateListener): () => void {
    this.stateListeners.add(handler);
    handler(this.state); // emit current state immediately
    return () => {
      this.stateListeners.delete(handler);
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
    this.setState('closed');
    this.listeners.clear();
    this.stateListeners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async openSocket(): Promise<void> {
    this.setState('connecting');
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) {
      // Without a token there's nothing to do — back off and try again later
      // in case auth flips on (e.g. user is mid-login when this fires).
      this.setState('error');
      this.scheduleReconnect();
      return;
    }

    const url = buildWebSocketUrl(this.conversationId, token);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.setState('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.refreshAttempted = false;
      this.setState('open');
      // Flush anything that was queued while disconnected
      while (this.outboundQueue.length > 0) {
        const next = this.outboundQueue.shift();
        if (next !== undefined) ws.send(next);
      }
    };

    ws.onmessage = (e: WebSocketMessageEvent) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(String(e.data)) as ServerEvent;
      } catch {
        return;
      }
      for (const l of this.listeners) {
        try {
          l(parsed);
        } catch (err) {
          console.warn('[ChatSocket] listener threw', err);
        }
      }
    };

    ws.onerror = () => {
      // onclose will fire after this; that's where we decide to reconnect.
      this.setState('error');
    };

    ws.onclose = (ev: WebSocketCloseEvent) => {
      this.ws = null;
      this.setState('closed');
      if (this.explicitlyClosed) return;

      if (ev.code === ACCESS_REVOKED) {
        this.explicitlyClosed = true;
        this.emitLocal({ type: 'access_revoked', conversation_id: this.conversationId });
        return;
      }

      // Token likely expired → refresh once, then reconnect immediately.
      // Subsequent failures fall through to backoff.
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
      // Single-flight: the backend rotates refresh tokens, so this must share
      // one in-flight refresh with the HTTP layer and the user socket — racing
      // refreshes invalidate each other and force-log the user out.
      await refreshTokensSingleFlight();
      // Refresh succeeded — reopen immediately, no backoff
      void this.openSocket();
    } catch {
      this.scheduleReconnect();
    }
  }

  private emitLocal(event: ServerEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.warn('[ChatSocket] listener threw', err);
      }
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

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.stateListeners) {
      try {
        l(next);
      } catch (err) {
        console.warn('[ChatSocket] state listener threw', err);
      }
    }
  }
}
