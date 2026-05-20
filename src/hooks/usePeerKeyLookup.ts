import { useEffect, useRef, useState } from 'react';
import { lookupContactApi } from '../services/api';

export function usePeerKeyLookup(
  contactPrivateNumber: string,
  isSelfChat: boolean | undefined,
  initialPeerKey?: string | null,
) {
  const [peerPublicKey, setPeerPublicKey] = useState<string | null>(
    initialPeerKey ?? null,
  );
  const peerPublicKeyRef = useRef<string | null>(initialPeerKey ?? null);

  useEffect(() => {
    peerPublicKeyRef.current = peerPublicKey;
  }, [peerPublicKey]);

  useEffect(() => {
    if (isSelfChat) return;
    if (peerPublicKey !== null) return;
    if (!contactPrivateNumber) return;
    let cancelled = false;
    lookupContactApi(contactPrivateNumber)
      .then((r) => {
        if (cancelled) return;
        if (r.found && r.user?.public_key) {
          setPeerPublicKey(r.user.public_key);
        }
      })
      .catch(() => {
        /* network error — leave key null and fall through to plaintext */
      });
    return () => {
      cancelled = true;
    };
  }, [contactPrivateNumber, peerPublicKey, isSelfChat]);

  return { peerPublicKey, peerPublicKeyRef };
}
