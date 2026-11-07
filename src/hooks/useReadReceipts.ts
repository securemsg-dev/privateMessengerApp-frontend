import { MutableRefObject, useEffect } from 'react';
import { ChatSocket } from '../services/socket';
import { Message } from '../store/slices/chatSlice';

// Mirrors the backend's MAX_RECEIPT_BATCH — one frame can ack a whole page.
const MAX_BATCH = 200;

export function useReadReceipts(
  socketRef: MutableRefObject<ChatSocket | null>,
  messages: Message[],
  senderId: string,
  isSelfChat: boolean | undefined,
  ackedReadRef: MutableRefObject<Set<string>>,
  isGroup = false,
) {
  useEffect(() => {
    if (isSelfChat) return;
    const sock = socketRef.current;
    if (!sock) return;
    // Batch all unacked reads into as few frames as possible. Sending one
    // frame per message trips the server's per-connection throttle when a
    // chat opens with many unread messages, and dropped receipts were never
    // retried — leaving the sender's ticks and unread counts stale.
    const unacked: string[] = [];
    for (const m of messages) {
      if (
        m.senderId !== senderId &&
        m.type !== 'system' &&
        m.status !== 'read' &&
        !ackedReadRef.current.has(m.id)
      ) {
        ackedReadRef.current.add(m.id);
        unacked.push(m.id);
      }
    }
    if (unacked.length === 0) return;
    if (isGroup) {
      // Groups keep a per-member read watermark server-side; acking the
      // newest message moves it past everything before. (Group messages
      // never become 'read' locally, so the ack set is what dedupes.)
      sock.send({ type: 'read', message_ids: [unacked[unacked.length - 1]] });
      return;
    }
    for (let i = 0; i < unacked.length; i += MAX_BATCH) {
      sock.send({ type: 'read', message_ids: unacked.slice(i, i + MAX_BATCH) });
    }
  }, [messages, senderId, isSelfChat, socketRef, ackedReadRef, isGroup]);
}
