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
  // Messages whose download is IN FLIGHT — avoids queueing the same blob on
  // every re-render. Entries are released when the download settles, so a
  // message that loses its local file again (the list was replaced by a fresh
  // server page) is simply fetched again — instantly, from the on-disk cache.
  const requested = useRef(new Set<string>());

  const hydrateMediaFor = useCallback(
    (messageId: string, envelope: MediaEnvelope) => {
      void (async () => {
        try {
          const localUri = await downloadAndDecryptMedia(envelope);
          dispatch(hydrateMessageMedia({ messageId, localUri }));
        } catch (err) {
          console.warn('[media] failed to hydrate', messageId, err);
        } finally {
          requested.current.delete(messageId); // settled — allow a later retry
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
        // View-once media downloads only when the recipient opens it.
        !m.viewOnce &&
        !requested.current.has(m.id),
    );
    if (pending.length === 0) return;
    pending.forEach((m) => requested.current.add(m.id));
    void (async () => {
      // One round trip for the whole page's download URLs, then fetch.
      try {
        await prefetchMediaUrls(pending.map((m) => m.mediaEnvelope!.blobId));
      } catch {
        /* best-effort — each download falls back to the envelope URL */
      }
      for (const m of pending) hydrateMediaFor(m.id, m.mediaEnvelope!);
    })();
  }, [messages, hydrateMediaFor]);

  return { hydrateMediaFor };
}
