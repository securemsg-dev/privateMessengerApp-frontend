import { MutableRefObject, useState } from 'react';
import { Alert } from 'react-native';
import { AppDispatch } from '../store';
import {
  Message,
  ReplyPreview,
  sendMessageThunk,
  updateMessageStatus,
} from '../store/slices/chatSlice';
import { ReplyContext } from '../components/QuoteBar';
import { Outbox } from '../services/outbox';
import { encryptionErrorText } from '../services/conversationCrypto';

export function useTextSender(
  conversationId: string,
  senderId: string,
  contactPrivateNumber: string,
  isSelfChat: boolean | undefined,
  outboxRef: MutableRefObject<Outbox | null>,
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
          senderName: replyTarget.senderName ?? null,
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
        const outbox = outboxRef.current;
        try {
          if (!outbox) throw undefined;
          await outbox.send(localId, trimmed, {
            message_type: 'text',
            reply_to_id: replyPreview?.id,
          });
        } catch (err) {
          if (__DEV__) console.warn('[crypto] encrypt failed; not sending:', err);
          dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
          Alert.alert('Message not sent', encryptionErrorText(err, !!outbox?.isGroup()));
        }
      })();
    }
    setText('');
    dismissReply();
  };

  return { text, setText, handleSend };
}
