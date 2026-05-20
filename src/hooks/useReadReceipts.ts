import { MutableRefObject, useEffect } from 'react';
import { ChatSocket } from '../services/socket';
import { Message } from '../store/slices/chatSlice';

export function useReadReceipts(
  socketRef: MutableRefObject<ChatSocket | null>,
  messages: Message[],
  senderId: string,
  isSelfChat: boolean | undefined,
  ackedReadRef: MutableRefObject<Set<string>>,
) {
  useEffect(() => {
    if (isSelfChat) return;
    const sock = socketRef.current;
    if (!sock) return;
    for (const m of messages) {
      if (
        m.senderId !== senderId &&
        m.status !== 'read' &&
        !ackedReadRef.current.has(m.id)
      ) {
        ackedReadRef.current.add(m.id);
        sock.send({ type: 'read', message_id: m.id });
      }
    }
  }, [messages, senderId, isSelfChat, socketRef, ackedReadRef]);
}
