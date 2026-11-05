import { useCallback, useEffect, useRef } from 'react';
import { AppDispatch } from '../store';
import { hydrateMessageMedia, Message } from '../store/slices/chatSlice';
import { downloadAndDecryptMedia, prefetchMediaUrls } from '../services/media';
import { MediaEnvelope } from '../services/crypto';

/**
 * Downloads + decrypts media for visible messages. Images, voice notes and
 * documents load automatically; videos wait until the user taps play (they
 * can be tens of MB and the bubble already shows a poster frame).
 */
export function useMediaHydration(dispatch: AppDispatch, messages: Message[]) {
  // Messages already handed to the downloader this session — avoids queueing
  // the same blob on every re-render while it's in flight.
  const requested = useRef(new Set<string>());

  const hydrateMediaFor = useCallback(
    (messageId: string, envelope: MediaEnvelope) => {
      void (async () => {
        try {
          const localUri = await downloadAndDecryptMedia(envelope);
          dispatch(hydrateMessageMedia({ messageId, localUri }));
        } catch (err) {
          requested.current.delete(messageId); // allow a retry next render
          console.warn('[media] failed to hydrate', messageId, err);
        }
      })();
    },
    [dispatch],
  );

  useEffect(() => {
    const pending = messages.filter(
      (m) =>
        m.mediaEnvelope &&
        !m.mediaUri &&
        m.type !== 'video' &&
        !requested.current.has(m.id),
    );
    if (pending.length === 0) return;
    pending.forEach((m) => requested.current.add(m.id));
    void (async () => {
      // One round trip for the whole page's download URLs, then fetch.
      await prefetchMediaUrls(pending.map((m) => m.mediaEnvelope!.blobId));
      for (const m of pending) hydrateMediaFor(m.id, m.mediaEnvelope!);
    })();
  }, [messages, hydrateMediaFor]);

  return { hydrateMediaFor };
}
