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

export class Outbox {
  private pending = new Map<string, Pending & { at: number }>();

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
    this.pending.set(localId, { plaintext, extras, retried: false, at: Date.now() });
    this.deps.socket()?.send({
      type: 'message',
      ...extras,
      encrypted_payload: payload,
      client_temp_id: localId,
    });
  }

  canEncrypt(): boolean {
    return canEncrypt(this.deps.crypto());
  }

  isGroup(): boolean {
    return this.deps.crypto().isGroup;
  }

  /** The server echoed our message → it's stored; forget the plaintext. */
  ack(clientTempId: string | null | undefined): void {
    if (clientTempId) this.pending.delete(clientTempId);
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
    this.pending.delete(id);
    this.deps.dispatch(updateMessageStatus({ id, status: 'failed' }));
  }

  private prune(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) if (p.at < cutoff) this.pending.delete(id);
  }
}
