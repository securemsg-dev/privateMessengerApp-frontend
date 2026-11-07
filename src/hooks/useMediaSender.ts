import { Alert } from 'react-native';
import { MutableRefObject } from 'react';
import { AppDispatch } from '../store';
import {
  mediaPlaceholder,
  MessageType,
  sendMessageThunk,
  updateMessageStatus,
} from '../store/slices/chatSlice';
import { MediaMeta } from '../services/crypto';
import { Outbox } from '../services/outbox';
import { encryptionErrorText } from '../services/conversationCrypto';
import { uploadEncryptedMedia } from '../services/media';
import { serverHasFeature } from '../services/serverFeatures';

export function useMediaSender(
  conversationId: string,
  senderId: string,
  contactPrivateNumber: string,
  isSelfChat: boolean | undefined,
  outboxRef: MutableRefObject<Outbox | null>,
  dispatch: AppDispatch,
) {
  const sendMediaAsset = async (
    localUri: string,
    mime: string,
    msgType: 'image' | 'video' | 'voice' | 'document',
    meta?: MediaMeta,
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
        mediaMeta: meta,
      }),
    );

    if (isSelfChat) return;

    try {
      // E2EE is mandatory: never send the media envelope in plaintext —
      // it contains the symmetric key for the uploaded blob. Check before
      // uploading so we never upload something we can't send.
      const outbox = outboxRef.current;
      if (!outbox || !outbox.canEncrypt()) {
        dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
        Alert.alert('Media not sent', encryptionErrorText(undefined, !!outbox?.isGroup()));
        return;
      }
      const { envelope } = await uploadEncryptedMedia(localUri, mime, meta);
      // Videos go out as 'video' when the backend knows the type; older
      // backends get the legacy 'image' (receivers detect video by mime).
      const wireType: 'voice' | 'image' | 'document' | 'video' =
        msgType === 'voice'
          ? 'voice'
          : msgType === 'document'
          ? 'document'
          : msgType === 'video' && serverHasFeature('video')
          ? 'video'
          : 'image';
      try {
        await outbox.send(localId, JSON.stringify(envelope), {
          message_type: wireType,
          // Lets the server delete the ciphertext file when this message is
          // deleted for everyone (blob id inside the envelope is unreadable).
          media_blob_id: envelope.blobId,
        });
      } catch (err) {
        if (__DEV__) console.warn('[crypto] envelope encrypt failed; not sending:', err);
        dispatch(updateMessageStatus({ id: localId, status: 'failed' }));
        Alert.alert('Media not sent', encryptionErrorText(err, outbox.isGroup()));
        return;
      }
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
