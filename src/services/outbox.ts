/**
 * Per-chat outbox: encrypts + sends outgoing messages and remembers their
 * plaintext until the server echoes them back.
 *
 * Why: in a group, the sender wraps the message key for the members it
 * knows about. If someone joined/left meanwhile, the server rejects the
 * frame with `group_members_changed`; we refresh the member list,
 * re-encrypt, and resend ONCE. Any other error that names a message
 * (client_temp_id) marks it failed instead of leaving it stuck at "sent".
 */
import type { AppDispatch } from '../store';
import {
  cryptoConvOf,
  refreshConversationThunk,
  updateMessageStatus,
} from '../store/slices/chatSlice';
import type { ChatSocket, ClientMessageEvent, ServerErrorEvent } from './socket';
import { canEncrypt, CryptoConv, encryptFor } from './conversationCrypto';

type FrameExtras = Omit<ClientMessageEvent, 'type' | 'encrypted_payload' | 'client_temp_id'>;

interface Pending {
  plaintext: string;
  extras: FrameExtras;
  retried: boolean;
}

/** Entries older than this are forgotten (the echo was missed or lost). */
const PENDING_TTL_MS = 5 * 60 * 1000;
/**
 * How long a message may sit un-echoed WHILE THE SOCKET IS OPEN before it is
 * shown as "Not sent". Time spent offline doesn't count: queued frames flush
 * on reconnect and the clock restarts then (see onSocketOpen).
 */
export const SEND_TIMEOUT_MS = 30 * 1000;

export class Outbox {
  private pending = new Map<string, Pending & { at: number }>();
  /** Failed sends kept (briefly) so "Tap to retry" can resend them as-is. */
  private failed = new Map<string, Pending & { at: number }>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly deps: {
      conversationId: string;
      dispatch: AppDispatch;
      socket: () => ChatSocket | null;
      crypto: () => CryptoConv;
    },
  ) {}

  /**
   * Encrypt for the conversation and send. Throws (without sending) when
   * encryption isn't possible — the caller shows the error and marks the
   * message failed.
   */
  async send(localId: string, plaintext: string, extras: FrameExtras): Promise<void> {
    const payload = await encryptFor(this.deps.crypto(), plaintext);
    this.prune();
    this.failed.delete(localId);
    this.pending.set(localId, { plaintext, extras, retried: false, at: Date.now() });
    this.deps.socket()?.send({
      type: 'message',
      ...extras,
      encrypted_payload: payload,
      client_temp_id: localId,
    });
    this.arm(localId);
  }

  /** True when a failed message can be resent without rebuilding it. */
  canRetry(localId: string): boolean {
    return this.failed.has(localId);
  }

  /**
   * Resend a failed message under the SAME client_temp_id (the server
   * de-duplicates on it, so a retry of a frame that did get through can't
   * create a second copy). Returns false when there is nothing to resend.
   */
  async retry(localId: string): Promise<boolean> {
    const entry = this.failed.get(localId);
    if (!entry) return false;
    this.deps.dispatch(updateMessageStatus({ id: localId, status: 'sending', force: true }));
    try {
      await this.send(localId, entry.plaintext, entry.extras);
      return true;
    } catch {
      this.failed.set(localId, entry);
      this.deps.dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
      return false;
    }
  }

  /** Socket (re)connected: queued frames were just flushed — restart clocks. */
  onSocketOpen(): void {
    for (const id of this.pending.keys()) this.arm(id);
  }

  /** Stop all timers (chat screen unmounted). */
  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  canEncrypt(): boolean {
    return canEncrypt(this.deps.crypto());
  }

  isGroup(): boolean {
    return this.deps.crypto().isGroup;
  }

  /** The server echoed our message → it's stored; forget the plaintext. */
  ack(clientTempId: string | null | undefined): void {
    if (!clientTempId) return;
    this.disarm(clientTempId);
    this.pending.delete(clientTempId);
    this.failed.delete(clientTempId);
  }

  async handleError(frame: ServerErrorEvent): Promise<void> {
    const id = frame.client_temp_id;
    if (!id) return;
    const entry = this.pending.get(id);
    if (frame.code === 'group_members_changed' && entry && !entry.retried) {
      entry.retried = true;
      try {
        const res = await this.deps
          .dispatch(refreshConversationThunk(this.deps.conversationId))
          .unwrap();
        if (res.conversation) {
          const payload = await encryptFor(cryptoConvOf(res.conversation), entry.plaintext);
          this.deps.socket()?.send({
            type: 'message',
            ...entry.extras,
            encrypted_payload: payload,
            client_temp_id: id,
          });
          return;
        }
      } catch (err) {
        if (__DEV__) console.warn('[outbox] resend after member change failed:', err);
      }
    }
    this.fail(id);
  }

  /** Mark failed, keeping the plaintext so the user can tap to retry. */
  private fail(id: string): void {
    this.disarm(id);
    const entry = this.pending.get(id);
    this.pending.delete(id);
    if (entry) this.failed.set(id, { ...entry, retried: false, at: Date.now() });
    this.deps.dispatch(updateMessageStatus({ id, status: 'failed' }));
  }

  private arm(id: string): void {
    this.disarm(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        if (!this.pending.has(id)) return;
        const sock = this.deps.socket();
        // Offline: the frame is still queued and will go out on reconnect.
        if (sock && !sock.isOpen()) {
          this.arm(id);
          return;
        }
        sock?.dropQueued(id);
        this.fail(id);
      }, SEND_TIMEOUT_MS),
    );
  }

  private disarm(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private prune(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) {
      if (p.at < cutoff) {
        this.disarm(id);
        this.pending.delete(id);
      }
    }
    for (const [id, p] of this.failed) if (p.at < cutoff) this.failed.delete(id);
  }
}
