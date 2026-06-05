import { Alert } from 'react-native';
import { MutableRefObject } from 'react';
import { AppDispatch } from '../store';
import { mediaPlaceholder, MessageType, sendMessageThunk } from '../store/slices/chatSlice';
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
      const { envelope } = await uploadEncryptedMedia(localUri, mime);
      let payload = JSON.stringify(envelope);
      if (peerPublicKeyRef.current) {
        try {
          payload = await encryptMessage(payload, peerPublicKeyRef.current);
        } catch (err) {
          console.warn('[crypto] media envelope encrypt failed:', err);
        }
      } else {
        console.warn('[crypto] no peer public key; envelope sent in plaintext');
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
      console.warn('[media] upload failed, message not delivered:', err);
      Alert.alert(
        'Upload failed',
        'Your media was saved locally but could not be sent. Tap and hold to retry later.',
      );
    }
  };

  return { sendMediaAsset };
}
