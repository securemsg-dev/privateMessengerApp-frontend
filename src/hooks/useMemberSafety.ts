import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { blockUserApi, reportUserApi, ReportReason } from '../services/api';
import { Message } from '../store/slices/chatSlice';
import { buildEvidence, buildReportBody } from '../utils/reportEvidence';

export interface SafetyTarget {
  userId: string;
  name: string;
}

/**
 * Report / block ONE member of a group (Google Play UGC policy). Used from
 * the long-press menu on someone's message and from the group member list.
 *
 * Evidence is limited to the reported member's own decrypted messages and is
 * only sent with explicit consent (buildReportBody owns that gate).
 */
export function useMemberSafety(
  conversationId: string,
  messages: Message[],
  myUserId: string,
) {
  const [target, setTarget] = useState<SafetyTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableEvidence = target ? buildEvidence(messages, myUserId, target.userId) : [];

  const openReport = useCallback((t: SafetyTarget) => setTarget(t), []);
  const closeReport = useCallback(() => setTarget(null), []);

  const blockMember = useCallback((t: SafetyTarget) => {
    Alert.alert(
      `Block ${t.name}?`,
      `They won't be able to message or call you, and you won't see their messages in groups. ${t.name} will not be told.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUserApi(t.userId);
              Alert.alert('Blocked', `${t.name} has been blocked.`);
            } catch {
              Alert.alert('Could not block', 'Please try again.');
            }
          },
        },
      ],
    );
  }, []);

  const submitReport = useCallback(
    async (args: { reason: ReportReason; details: string; includeMessages: boolean; alsoBlock: boolean }) => {
      if (!target) return;
      setSubmitting(true);
      try {
        await reportUserApi(
          buildReportBody({
            userId: target.userId,
            reason: args.reason,
            details: args.details,
            conversationId,
            includeMessages: args.includeMessages,
            evidence: availableEvidence,
          }),
        );
        if (args.alsoBlock) {
          try {
            await blockUserApi(target.userId);
          } catch {
            /* the report landed; a failed block shouldn't read as failure */
          }
        }
        setTarget(null);
        Alert.alert(
          'Report sent',
          'Thanks — our team reviews reports within 24 hours. You will not be contacted unless we need more information.',
        );
      } catch {
        Alert.alert('Could not send report', 'Please check your connection and try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [target, conversationId, availableEvidence],
  );

  return { target, submitting, availableEvidence, openReport, closeReport, blockMember, submitReport };
}
