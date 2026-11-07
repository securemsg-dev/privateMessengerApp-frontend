/**
 * The single place that knows HOW a conversation's messages are encrypted.
 *
 *   1:1   → envelope v1: nacl.box with the peer's key (decrypts both ways)
 *   group → envelope v2: one message key wrapped for every current member;
 *           decrypted with the SENDER's key
 *   system (groups) → plaintext JSON written by the server
 *
 * Pure (no React), so thunks, hooks, notifications and forwarding all share
 * it instead of each assuming a single peer.
 */
import {
  decryptGroupMessage,
  decryptOrFallback,
  encryptGroupMessage,
  encryptMessage,
  isGroupEnvelope,
  MissingRecipientKeyError,
} from './crypto';
import { describeSystemEvent } from '../utils/systemMessage';

export interface CryptoMember {
  userId: string;
  publicKey: string | null;
}

export interface CryptoConv {
  isGroup: boolean;
  /** 1:1 only. */
  peerPublicKey: string | null;
  /** Groups only: current members INCLUDING me. */
  members: CryptoMember[];
}

export const NO_CRYPTO: CryptoConv = { isGroup: false, peerPublicKey: null, members: [] };

export class EncryptionUnavailableError extends Error {}

/** True when encryptFor would succeed (checked before uploading media). */
export function canEncrypt(conv: CryptoConv): boolean {
  if (conv.isGroup) return conv.members.length > 0 && conv.members.every((m) => !!m.publicKey);
  return !!conv.peerPublicKey;
}

/** User-facing explanation for a failed encrypt. */
export function encryptionErrorText(err: unknown, isGroup: boolean): string {
  if (err instanceof MissingRecipientKeyError) {
    return "Someone in this group hasn't set up encryption yet, so the message wasn't sent.";
  }
  if (err instanceof EncryptionUnavailableError || err === undefined) {
    return isGroup
      ? "This group's member list isn't loaded yet. Check your connection and try again."
      : "This contact's encryption key isn't available yet. Check your connection and try again.";
  }
  return 'The message could not be encrypted, so it was not sent.';
}

/** Encrypt an outgoing payload for this conversation. Throws if impossible. */
export async function encryptFor(conv: CryptoConv, plaintext: string): Promise<string> {
  if (conv.isGroup) {
    if (conv.members.length === 0) throw new EncryptionUnavailableError('Group members not loaded');
    return encryptGroupMessage(plaintext, conv.members);
  }
  if (!conv.peerPublicKey) throw new EncryptionUnavailableError('Peer key not available');
  return encryptMessage(plaintext, conv.peerPublicKey);
}

export interface IncomingPayload {
  payload: string;
  messageType: string;
  senderId: string;
  /** Group messages: the sender's key as sent by the server. */
  senderPublicKey?: string | null;
}

/** Decrypt (or describe) an incoming payload. Never throws. */
export async function decryptFor(
  conv: CryptoConv,
  msg: IncomingPayload,
  myUserId: string | null,
): Promise<string> {
  if (msg.messageType === 'system') return describeSystemEvent(msg.payload, myUserId);
  if (!msg.payload) return ''; // deleted-for-everyone tombstone
  if (isGroupEnvelope(msg.payload)) {
    const senderKey =
      msg.senderPublicKey ?? conv.members.find((m) => m.userId === msg.senderId)?.publicKey ?? null;
    if (!senderKey || !myUserId) return '🔒 Encrypted message';
    try {
      return (await decryptGroupMessage(msg.payload, myUserId, senderKey)) ?? '🔒 Cannot decrypt';
    } catch {
      return '🔒 Cannot decrypt';
    }
  }
  try {
    return await decryptOrFallback(msg.payload, conv.peerPublicKey);
  } catch {
    return '🔒 Cannot decrypt';
  }
}
