import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { AppDispatch } from '../store';
import {
  applyReactionEvent,
  clearActiveMessages,
  effectiveType,
  markMessageDeletedForEveryone,
  mediaPlaceholder,
  Message,
  refreshConversationThunk,
  setPeerPresence,
  updateMessageStatus,
  upsertMessage,
} from '../store/slices/chatSlice';
import { ChatSocket, ServerEvent, ServerMessageEvent } from '../services/socket';
import { saveMessage as saveMessageLocal } from '../services/database';
import { MediaEnvelope, parseMediaEnvelope } from '../services/crypto';
import { CryptoConv, decryptFor } from '../services/conversationCrypto';
import { Outbox } from '../services/outbox';

export function useChatSocket(
  conversationId: string,
  isSelfChat: boolean | undefined,
  senderId: string,
  cryptoRef: MutableRefObject<CryptoConv>,
  outboxRef: MutableRefObject<Outbox | null>,
  dispatch: AppDispatch,
  hydrateMediaFor: (messageId: string, envelope: MediaEnvelope) => void,
  /** Called when the server says we're no longer a member (4403). */
  onAccessRevoked?: () => void,
) {
  const socketRef = useRef<ChatSocket | null>(null);
  const senderIdRef = useRef(senderId);
  const ackedReadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    senderIdRef.current = senderId;
  }, [senderId]);
  const onAccessRevokedRef = useRef(onAccessRevoked);
  onAccessRevokedRef.current = onAccessRevoked;

  const handleMessage = async (event: ServerMessageEvent) => {
    const isMine = event.sender_id === senderIdRef.current;
    if (isMine) outboxRef.current?.ack(event.client_temp_id);

    // Decrypt everything — including our own echo, so a message we sent
    // from another device shows text instead of ciphertext.
    const plaintext = await decryptFor(
      cryptoRef.current,
      {
        payload: event.encrypted_payload,
        messageType: event.message_type,
        senderId: event.sender_id,
        senderPublicKey: event.sender_public_key,
      },
      senderIdRef.current,
    );
    const envelope = event.message_type === 'system' ? null : parseMediaEnvelope(plaintext);
    const message: Message = {
      // Always the server id: if there's an optimistic row it keeps its
      // local id (matchClientTempId below); if not, this is what we insert.
      id: event.message_id,
      conversationId: event.conversation_id,
      senderId: event.sender_id,
      receiverId: '',
      content: envelope ? mediaPlaceholder(envelope.mime) : plaintext,
      type: effectiveType(event.message_type, envelope),
      timestamp: event.timestamp,
      status: 'sent',
      reactions: [],
      isStarred: false,
      replyToId: event.reply_to_id ?? null,
      replyPreview: null,
      deletedAt: null,
      deletedBy: null,
      mediaEnvelope: envelope,
      senderName: event.sender_display_name ?? null,
    };

    if (isMine) {
      // Matches the optimistic row when there is one (keeps its local id,
      // media path and metadata); otherwise inserts the decrypted message.
      dispatch(upsertMessage({ message, matchClientTempId: event.client_temp_id ?? undefined }));
      return;
    }

    dispatch(upsertMessage({ message }));
    void saveMessageLocal(
      message.id,
      message.conversationId,
      message.senderId,
      message.receiverId,
      message.content,
      message.type,
      message.mediaUri,
    );
    // Videos download on tap (viewer), not automatically.
    if (envelope && message.type !== 'video') {
      hydrateMediaFor(message.id, envelope);
    }
  };

  const handleSocketEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === 'message') {
        void handleMessage(event);
        return;
      }
      if (event.type === 'error') {
        void outboxRef.current?.handleError(event);
        return;
      }
      if (event.type === 'group_update') {
        // Members / name changed: refresh (the outbox and header read it).
        void dispatch(refreshConversationThunk(conversationId));
        return;
      }
      if (event.type === 'access_revoked') {
        void dispatch(refreshConversationThunk(conversationId));
        onAccessRevokedRef.current?.();
        return;
      }
      if (event.type === 'presence') {
        // Our own presence echoes through the same channel — ignore it.
        if (event.user_id === senderIdRef.current) return;
        dispatch(
          setPeerPresence({
            userId: event.user_id,
            online: event.online,
            lastSeen: event.last_seen,
          }),
        );
        return;
      }
      if (event.type === 'delivery' || event.type === 'read') {
        if (event.by_user_id === senderIdRef.current) return;
        const ids = event.message_ids ?? [event.message_id];
        for (const id of ids) {
          dispatch(
            updateMessageStatus({
              id,
              status: event.type === 'read' ? 'read' : 'delivered',
            }),
          );
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, conversationId, hydrateMediaFor],
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
