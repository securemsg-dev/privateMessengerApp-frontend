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
import { Conversation } from '../store/slices/chatSlice';
import { ChatSocket } from '../services/socket';
import { encryptMessage } from '../services/crypto';
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
    let payload = m.content;
    if (target.contactPublicKey) {
      try {
        payload = await encryptMessage(m.content, target.contactPublicKey);
      } catch (err) {
        Alert.alert("Couldn't forward", 'Encryption failed for the target conversation.');
        console.warn('[forward] encrypt failed:', err);
        return;
      }
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
