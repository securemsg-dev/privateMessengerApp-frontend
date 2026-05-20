import { useCallback, useEffect } from 'react';
import { AppDispatch } from '../store';
import { hydrateMessageMedia, Message } from '../store/slices/chatSlice';
import { downloadAndDecryptMedia } from '../services/media';
import { MediaEnvelope } from '../services/crypto';

export function useMediaHydration(dispatch: AppDispatch, messages: Message[]) {
  const hydrateMediaFor = useCallback(
    (messageId: string, envelope: MediaEnvelope) => {
      void (async () => {
        try {
          const localUri = await downloadAndDecryptMedia(envelope);
          dispatch(hydrateMessageMedia({ messageId, localUri }));
        } catch (err) {
          console.warn('[media] failed to hydrate', messageId, err);
        }
      })();
    },
    [dispatch],
  );

  useEffect(() => {
    for (const m of messages) {
      if (m.mediaEnvelope && !m.mediaUri) {
        hydrateMediaFor(m.id, m.mediaEnvelope);
      }
    }
  }, [messages, hydrateMediaFor]);

  return { hydrateMediaFor };
}
