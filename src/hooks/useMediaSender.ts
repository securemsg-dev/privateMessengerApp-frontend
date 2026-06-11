import { Alert } from 'react-native';
import { MutableRefObject } from 'react';
import { AppDispatch } from '../store';
import {
  mediaPlaceholder,
  MessageType,
  sendMessageThunk,
  updateMessageStatus,
} from '../store/slices/chatSlice';
import { ChatSocket } from '../services/socket';
import { encryptMessage } from '../services/crypto';
import { uploadEncryptedMedia } from '../services/media';

export function useMediaSender(
  conversationId: string,
  senderId: string,
  contactPrivateNumber: string,
  isSelfChat: boolean | undefined,
  socketRef: MutableRefObject<ChatSocket | null>,
  peerPublicKeyRef: MutableRefObject<string | null>,
  dispatch: AppDispatch,
) {
  const sendMediaAsset = async (
    localUri: string,
    mime: string,
    msgType: 'image' | 'video' | 'voice' | 'document',
  ) => {
    const localId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    const placeholder = mediaPlaceholder(mime);

    dispatch(
      sendMessageThunk({
        id: localId,
        conversationId,
        senderId,
        receiverId: contactPrivateNumber,
        content: placeholder,
        type: msgType as MessageType,
        mediaUri: localUri,
      }),
    );

    if (isSelfChat) return;

    try {
      // E2EE is mandatory: never send the media envelope in plaintext —
      // it contains the symmetric key for the uploaded blob.
      const peerKey = peerPublicKeyRef.current;
      if (!peerKey) {
        dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
        Alert.alert(
          'Media not sent',
          "This contact's encryption key isn't available yet. Check your connection and try again.",
        );
        return;
      }
      const { envelope } = await uploadEncryptedMedia(localUri, mime);
      let payload: string;
      try {
        payload = await encryptMessage(JSON.stringify(envelope), peerKey);
      } catch (err) {
        if (__DEV__) console.warn('[crypto] envelope encrypt failed; not sending:', err);
        dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
        Alert.alert(
          'Media not sent',
          'The attachment could not be encrypted, so it was not sent.',
        );
        return;
      }
      const wireType: 'text' | 'voice' | 'image' | 'document' =
        msgType === 'voice' ? 'voice' : msgType === 'document' ? 'document' : 'image';
      socketRef.current?.send({
        type: 'message',
        message_type: wireType,
        encrypted_payload: payload,
        client_temp_id: localId,
      });
    } catch (err) {
      if (__DEV__) console.warn('[media] upload failed, message not delivered:', err);
      dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
      Alert.alert(
        'Upload failed',
        'Your media was saved locally but could not be sent. Tap and hold to retry later.',
      );
    }
  };

  return { sendMediaAsset };
}
