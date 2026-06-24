import { useEffect, useRef } from 'react';
import { useDispatch, useStore } from 'react-redux';

import { AppDispatch, RootState } from '../store';
import {
  applyMessageNotification,
  loadConversationsThunk,
  MessageType,
} from '../store/slices/chatSlice';
import { decryptOrFallback } from '../services/crypto';
import { userSocketBus } from '../services/userSocketBus';

/** Short, list-friendly preview for non-text messages (payload is encrypted
 *  media, so there's nothing to decrypt into readable text). */
function previewForType(messageType: MessageType): string | null {
  switch (messageType) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎬 Video';
    case 'voice':
      return '🎤 Voice message';
    case 'document':
      return '📎 Document';
    default:
      return null; // text — decrypt the payload instead
  }
}

/**
 * Subscribes to live `message_notification` frames arriving on the per-user
 * socket and keeps the conversation list current — reordering, refreshing the
 * last-message preview, and bumping unread — even when the user isn't in that
 * chat. Mount once under the Redux provider (e.g. in RootNavigator).
 */
export function useMessageNotifications() {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  // Debounce list refreshes for notifications about unknown conversations.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = userSocketBus.subscribe((event) => {
      if (event.type !== 'message_notification') return;

      const conversationId = String(event.conversation_id ?? '');
      if (!conversationId) return;
      const messageType = (event.message_type as MessageType) || 'text';
      const timestamp = String(event.timestamp ?? new Date().toISOString());
      const encryptedPayload = String(event.encrypted_payload ?? '');

      const conv = store
        .getState()
        .chat.conversations.find((c) => c.id === conversationId);

      // Unknown conversation (e.g. someone started a new chat) — pull the
      // list from the server, debounced so a burst collapses into one fetch.
      if (!conv) {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          dispatch(loadConversationsThunk());
        }, 400);
        return;
      }

      void (async () => {
        const typePreview = previewForType(messageType);
        const preview =
          typePreview ??
          (await decryptOrFallback(encryptedPayload, conv.contactPublicKey));
        dispatch(
          applyMessageNotification({
            conversationId,
            preview,
            messageType,
            timestamp,
          }),
        );
      })();
    });

    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [dispatch, store]);
}
