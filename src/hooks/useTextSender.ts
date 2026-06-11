import { MutableRefObject, useState } from 'react';
import { Alert } from 'react-native';
import { AppDispatch } from '../store';
import {
  Message,
  ReplyPreview,
  sendMessageThunk,
  updateMessageStatus,
} from '../store/slices/chatSlice';
import { ChatSocket } from '../services/socket';
import { encryptMessage } from '../services/crypto';
import { ReplyContext } from '../components/QuoteBar';

export function useTextSender(
  conversationId: string,
  senderId: string,
  contactPrivateNumber: string,
  isSelfChat: boolean | undefined,
  socketRef: MutableRefObject<ChatSocket | null>,
  peerPublicKeyRef: MutableRefObject<string | null>,
  dispatch: AppDispatch,
  replyTo: ReplyContext | null,
  dismissReply: () => void,
  messages: Message[],
) {
  const [text, setText] = useState('');

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const localId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);

    const replyTarget: Message | undefined = replyTo
      ? messages.find(
          (m) =>
            m.content === replyTo.preview &&
            m.type === replyTo.type &&
            (replyTo.mediaUri == null || m.mediaUri === replyTo.mediaUri),
        )
      : undefined;
    const replyPreview: ReplyPreview | null = replyTarget
      ? {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          type: replyTarget.type,
          content: replyTarget.content,
        }
      : null;

    dispatch(
      sendMessageThunk({
        id: localId,
        conversationId,
        senderId,
        receiverId: contactPrivateNumber,
        content: trimmed,
        type: 'text',
        replyTo: replyPreview,
      }),
    );

    if (!isSelfChat) {
      void (async () => {
        // E2EE is mandatory: never fall back to plaintext over the wire.
        const peerKey = peerPublicKeyRef.current;
        if (!peerKey) {
          dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
          Alert.alert(
            'Message not sent',
            "This contact's encryption key isn't available yet. Check your connection and try again.",
          );
          return;
        }
        let payload: string;
        try {
          payload = await encryptMessage(trimmed, peerKey);
        } catch (err) {
          if (__DEV__) console.warn('[crypto] encrypt failed; not sending:', err);
          dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
          Alert.alert(
            'Message not sent',
            'The message could not be encrypted, so it was not sent.',
          );
          return;
        }
        socketRef.current?.send({
          type: 'message',
          message_type: 'text',
          encrypted_payload: payload,
          client_temp_id: localId,
          reply_to_id: replyPreview?.id,
        });
      })();
    }
    setText('');
    dismissReply();
  };

  return { text, setText, handleSend };
}
