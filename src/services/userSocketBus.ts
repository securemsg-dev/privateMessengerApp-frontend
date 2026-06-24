/**
 * userSocketBus
 * ─────────────
 * A tiny in-process event bus for NON-call events arriving on the single
 * per-user WebSocket (`/ws/user`). The socket itself is owned by CallProvider
 * (it also carries call signaling); rather than couple chat logic into the
 * call layer, CallProvider forwards any non-call frame here and interested
 * features (e.g. live chat-list updates) subscribe.
 *
 * Keeping one socket — and fanning out in JS — avoids opening a second
 * always-on connection per user.
 */

export interface UserSocketEvent {
  type: string;
  [key: string]: unknown;
}

type Handler = (event: UserSocketEvent) => void;

const handlers = new Set<Handler>();

export const userSocketBus = {
  /** Publish a parsed user-socket frame to all subscribers. */
  emit(event: UserSocketEvent): void {
    handlers.forEach((h) => {
      try {
        h(event);
      } catch (err) {
        if (__DEV__) console.warn('[userSocketBus] handler threw', err);
      }
    });
  },
  /** Subscribe; returns an unsubscribe function. */
  subscribe(handler: Handler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },
};
