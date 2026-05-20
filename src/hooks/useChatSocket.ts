import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { AppDispatch } from '../store';
import {
  applyReactionEvent,
  clearActiveMessages,
  markMessageDeletedForEveryone,
  mediaPlaceholder,
  Message,
  updateMessageStatus,
  upsertMessage,
} from '../store/slices/chatSlice';
import { ChatSocket, ServerEvent } from '../services/socket';
import { saveMessage as saveMessageLocal } from '../services/database';
import { decryptOrFallback, MediaEnvelope, parseMediaEnvelope } from '../services/crypto';

export function useChatSocket(
  conversationId: string,
  isSelfChat: boolean | undefined,
  senderId: string,
  peerPublicKeyRef: MutableRefObject<string | null>,
  dispatch: AppDispatch,
  hydrateMediaFor: (messageId: string, envelope: MediaEnvelope) => void,
) {
  const socketRef = useRef<ChatSocket | null>(null);
  const senderIdRef = useRef(senderId);
  const ackedReadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    senderIdRef.current = senderId;
  }, [senderId]);

  const handleSocketEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === 'message') {
        if (event.sender_id === senderIdRef.current) {
          if (event.client_temp_id) {
            dispatch(
              upsertMessage({
                message: {
                  id: event.client_temp_id,
                  conversationId: event.conversation_id,
                  senderId: event.sender_id,
                  receiverId: '',
                  content: event.encrypted_payload,
                  type: event.message_type as Message['type'],
                  timestamp: event.timestamp,
                  status: 'sent',
                  reactions: [],
                  isStarred: false,
                  replyToId: event.reply_to_id ?? null,
                  replyPreview: null,
                  deletedAt: null,
                  deletedBy: null,
                  mediaEnvelope: null,
                },
                matchClientTempId: event.client_temp_id,
              }),
            );
          }
          return;
        }
        const peerKey = peerPublicKeyRef.current;
        const ciphertext = event.encrypted_payload;
        void (async () => {
          let plaintext: string;
          try {
            plaintext = await decryptOrFallback(ciphertext, peerKey);
          } catch (err) {
            console.warn('[crypto] decrypt failed:', err);
            plaintext = '🔒 Cannot decrypt';
          }
          const envelope = parseMediaEnvelope(plaintext);
          const incoming: Message = {
            id: event.message_id,
            conversationId: event.conversation_id,
            senderId: event.sender_id,
            receiverId: '',
            content: envelope ? mediaPlaceholder(envelope.mime) : plaintext,
            type: event.message_type as Message['type'],
            timestamp: event.timestamp,
            status: 'sent',
            reactions: [],
            isStarred: false,
            replyToId: event.reply_to_id ?? null,
            replyPreview: null,
            deletedAt: null,
            deletedBy: null,
            mediaEnvelope: envelope,
          };
          dispatch(upsertMessage({ message: incoming }));
          void saveMessageLocal(
            incoming.id,
            incoming.conversationId,
            incoming.senderId,
            incoming.receiverId,
            incoming.content,
            incoming.type,
            incoming.mediaUri,
          );
          if (envelope) {
            hydrateMediaFor(incoming.id, envelope);
          }
        })();
        return;
      }
      if (event.type === 'delivery' || event.type === 'read') {
        if (event.by_user_id === senderIdRef.current) return;
        dispatch(
          updateMessageStatus({
            id: event.message_id,
            status: event.type === 'read' ? 'read' : 'delivered',
          }),
        );
        return;
      }
      if (event.type === 'reaction') {
        dispatch(
          applyReactionEvent({
            messageId: event.message_id,
            emoji: event.emoji,
            byMe: event.by_user_id === senderIdRef.current,
            action: event.action,
          }),
        );
        return;
      }
      if (event.type === 'deletion') {
        dispatch(
          markMessageDeletedForEveryone({
            messageId: event.message_id,
            byUserId: event.by_user_id,
            timestamp: event.timestamp,
          }),
        );
      }
    },
    [dispatch, peerPublicKeyRef, hydrateMediaFor],
  );

  useEffect(() => {
    if (isSelfChat) {
      return () => {
        dispatch(clearActiveMessages());
        ackedReadRef.current.clear();
      };
    }
    const sock = new ChatSocket(conversationId);
    socketRef.current = sock;
    const unsubEvent = sock.onEvent(handleSocketEvent);
    void sock.connect();
    return () => {
      unsubEvent();
      sock.close();
      socketRef.current = null;
      dispatch(clearActiveMessages());
      ackedReadRef.current.clear();
    };
  }, [conversationId, isSelfChat, dispatch, handleSocketEvent]);

  return { socketRef, senderIdRef, ackedReadRef };
}
