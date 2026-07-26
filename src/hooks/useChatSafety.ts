import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import {
  blockStatusApi,
  blockUserApi,
  lookupContactApi,
  reportUserApi,
  unblockUserApi,
  ReportEvidenceMessage,
  ReportReason,
} from '../services/api';
import { Message } from '../store/slices/chatSlice';
import { buildEvidence, buildReportBody } from '../utils/reportEvidence';

/**
 * Block + report state for one chat (Google Play UGC policy).
 *
 * Resolves the peer's user id from their private number, because block and
 * report are keyed on user id while navigation only carries the number.
 *
 * Evidence is assembled here from already-decrypted Redux messages. Nothing
 * is sent anywhere until the user submits the report AND ticks the consent
 * switch — `includeMessages` is what gates it, and the server independently
 * drops the payload when that flag is false.
 */
export function useChatSafety(
  contactPrivateNumber: string,
  contactName: string,
  conversationId: string,
  isSelfChat: boolean | undefined,
  messages: Message[],
  senderId: string,
) {
  const [peerUserId, setPeerUserId] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Resolve peer id, then their current block status.
  useEffect(() => {
    if (isSelfChat || !contactPrivateNumber) return;
    let cancelled = false;
    lookupContactApi(contactPrivateNumber)
      .then(async (r) => {
        if (cancelled || !r.found || !r.user) return;
        setPeerUserId(r.user.id);
        try {
          const status = await blockStatusApi(r.user.id);
          if (!cancelled) setIsBlocked(status.blocked);
        } catch {
          /* non-fatal — the menu just shows "Block" until it resolves */
        }
      })
      .catch(() => {
        /* offline: block/report stay unavailable rather than failing loudly */
      });
    return () => {
      cancelled = true;
    };
  }, [contactPrivateNumber, isSelfChat]);

  /** The peer's recent messages, decrypted, oldest→newest. */
  const availableEvidence: ReportEvidenceMessage[] = buildEvidence(
    messages,
    senderId,
  );

  const toggleBlock = useCallback(() => {
    if (!peerUserId) return;
    setMenuOpen(false);

    if (isBlocked) {
      Alert.alert(
        `Unblock ${contactName}?`,
        'They will be able to message and call you again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unblock',
            onPress: async () => {
              try {
                await unblockUserApi(peerUserId);
                setIsBlocked(false);
              } catch {
                Alert.alert('Could not unblock', 'Please try again.');
              }
            },
          },
        ],
      );
      return;
    }

    Alert.alert(
      `Block ${contactName}?`,
      `They will no longer be able to message or call you. ${contactName} will not be told.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUserApi(peerUserId);
              setIsBlocked(true);
            } catch {
              Alert.alert('Could not block', 'Please try again.');
            }
          },
        },
      ],
    );
  }, [peerUserId, isBlocked, contactName]);

  const openReport = useCallback(() => {
    setMenuOpen(false);
    setReportOpen(true);
  }, []);

  const submitReport = useCallback(
    async (args: {
      reason: ReportReason;
      details: string;
      includeMessages: boolean;
      alsoBlock: boolean;
    }) => {
      if (!peerUserId) return;
      setSubmitting(true);
      try {
        // buildReportBody owns the consent gate — see utils/reportEvidence.ts.
        await reportUserApi(
          buildReportBody({
            userId: peerUserId,
            reason: args.reason,
            details: args.details,
            conversationId,
            includeMessages: args.includeMessages,
            evidence: availableEvidence,
          }),
        );

        if (args.alsoBlock && !isBlocked) {
          try {
            await blockUserApi(peerUserId);
            setIsBlocked(true);
          } catch {
            /* the report landed; a failed block shouldn't read as failure */
          }
        }

        setReportOpen(false);
        Alert.alert(
          'Report sent',
          'Thanks — our team reviews reports within 24 hours. You will not be contacted unless we need more information.',
        );
      } catch {
        Alert.alert(
          'Could not send report',
          'Please check your connection and try again.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [peerUserId, conversationId, availableEvidence, isBlocked],
  );

  return {
    peerUserId,
    isBlocked,
    menuOpen,
    setMenuOpen,
    reportOpen,
    setReportOpen,
    submitting,
    availableEvidence,
    toggleBlock,
    openReport,
    submitReport,
  };
}
