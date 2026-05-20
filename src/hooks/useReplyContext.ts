import { RefObject, useCallback, useState } from 'react';
import { TextInput } from 'react-native';
import { ReplyContext } from '../components/QuoteBar';
import { Message } from '../store/slices/chatSlice';

export function useReplyContext(
  messages: Message[],
  senderId: string,
  displayName: string | null,
  contactName: string,
  textInputRef: RefObject<TextInput | null>,
) {
  const [replyTo, setReplyTo] = useState<ReplyContext | null>(null);

  const handleReply = useCallback(
    (m: Message) => {
      const senderName =
        m.senderId === senderId ? displayName || 'yourself' : contactName || 'them';
      setReplyTo({
        senderName,
        preview: m.content,
        type: m.type,
        mediaUri: m.mediaUri,
      });
      setTimeout(() => textInputRef.current?.focus(), 50);
    },
    [senderId, displayName, contactName, textInputRef],
  );

  const dismissReply = useCallback(() => {
    setReplyTo(null);
    textInputRef.current?.focus();
  }, [textInputRef]);

  return { replyTo, setReplyTo, handleReply, dismissReply };
}
