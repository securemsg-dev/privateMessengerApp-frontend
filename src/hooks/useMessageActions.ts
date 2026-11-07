import { MutableRefObject, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-deprecated
import { Alert, Clipboard, Keyboard } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AppDispatch } from '../store';
import {
  markMessageDeletedForEveryone,
  Message,
  removeMessage,
  setMessageStarred,
  upsertMessage,
} from '../store/slices/chatSlice';
import { Conversation, cryptoConvOf, refreshConversationThunk } from '../store/slices/chatSlice';
import { ChatSocket } from '../services/socket';
import { encryptFor } from '../services/conversationCrypto';
import { deleteMessageApi, starMessageApi, ApiError } from '../services/api';
import { BubbleRect } from '../components/MessageActionSheet';

interface ActionSheetState {
  message: Message;
  rect: BubbleRect;
  isSent: boolean;
}

export function useMessageActions(
  dispatch: AppDispatch,
  senderId: string,
  socketRef: MutableRefObject<ChatSocket | null>,
) {
  const [actionSheet, setActionSheet] = useState<ActionSheetState | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);

  const openActionSheet = (m: Message, isSent: boolean, rect: BubbleRect) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Keyboard.dismiss();
    setActionSheet({ message: m, isSent, rect });
  };

  const closeActionSheet = () => setActionSheet(null);

  const handleCopyText = (m: Message) => {
    if (m.type !== 'text') return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    Clipboard.setString(m.content);
    Alert.alert('Copied', 'Message text copied to clipboard.');
  };

  const handleStar = (m: Message) => {
    const next = !m.isStarred;
    dispatch(setMessageStarred({ messageId: m.id, starred: next }));
    starMessageApi(m.id, next).catch((err) => {
      dispatch(setMessageStarred({ messageId: m.id, starred: m.isStarred }));
      console.warn('[chat] star failed:', err);
    });
  };

  const handleDelete = (m: Message) => {
    const ageMs = Date.now() - new Date(m.timestamp).getTime();
    const canDeleteForEveryone =
      ageMs <= 24 * 60 * 60 * 1000 && m.senderId === senderId;

    const doDeleteForMe = async () => {
      dispatch(removeMessage({ messageId: m.id }));
      try {
        await deleteMessageApi(m.id, 'me');
      } catch (err) {
        dispatch(upsertMessage({ message: m }));
        Alert.alert(
          "Couldn't delete",
          err instanceof ApiError ? err.detail : 'Try again later.',
        );
      }
    };

    const doDeleteForEveryone = async () => {
      dispatch(
        markMessageDeletedForEveryone({
          messageId: m.id,
          byUserId: senderId,
          timestamp: new Date().toISOString(),
        }),
      );
      try {
        await deleteMessageApi(m.id, 'everyone');
      } catch (err) {
        dispatch(upsertMessage({ message: m }));
        Alert.alert(
          "Couldn't delete for everyone",
          err instanceof ApiError ? err.detail : 'Try again later.',
        );
      }
    };

    const buttons: Array<{
      text: string;
      style?: 'default' | 'cancel' | 'destructive';
      onPress?: () => void;
    }> = [{ text: 'Cancel', style: 'cancel' }];
    if (canDeleteForEveryone) {
      buttons.push({ text: 'Delete for everyone', style: 'destructive', onPress: doDeleteForEveryone });
    }
    buttons.push({ text: 'Delete for me', style: 'destructive', onPress: doDeleteForMe });
    Alert.alert('Delete message', 'This message will be removed.', buttons);
  };

  const handleReact = (m: Message, emoji: string) => {
    socketRef.current?.send({ type: 'reaction', message_id: m.id, emoji });
  };

  const handleForward = (m: Message) => {
    if (m.deletedAt) {
      Alert.alert("Can't forward", 'This message was deleted.');
      return;
    }
    if (m.type !== 'text') {
      Alert.alert("Can't forward yet", 'Only text messages can be forwarded in this version.');
      return;
    }
    setForwardingMessage(m);
  };

  const performForward = async (target: Conversation) => {
    const m = forwardingMessage;
    if (!m) return;
    setForwardingMessage(null);
    // E2EE is mandatory — never forward in plaintext. Groups are encrypted
    // for a freshly fetched member list so the server accepts the frame.
    let payload: string;
    try {
      let dest = target;
      if (target.isGroup) {
        const res = await dispatch(refreshConversationThunk(target.id)).unwrap();
        if (!res.conversation) throw new Error('No longer a member');
        dest = res.conversation;
      }
      payload = await encryptFor(cryptoConvOf(dest), m.content);
    } catch (err) {
      Alert.alert("Couldn't forward", 'This message could not be encrypted for that chat.');
      console.warn('[forward] encrypt failed:', err);
      return;
    }
    const sock = new ChatSocket(target.id);
    sock.onState((state) => {
      if (state === 'open') {
        sock.send({ type: 'message', message_type: 'text', encrypted_payload: payload });
        setTimeout(() => sock.close(), 400);
      }
    });
    void sock.connect();
    Alert.alert('Forwarded', `Sent to ${target.contactName || 'chat'}.`);
  };

  return {
    actionSheet,
    setActionSheet,
    openActionSheet,
    closeActionSheet,
    handleCopyText,
    handleStar,
    handleDelete,
    handleReact,
    handleForward,
    performForward,
    forwardingMessage,
    setForwardingMessage,
  };
}
