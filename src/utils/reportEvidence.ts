import { ReportBody, ReportEvidenceMessage, ReportReason } from '../services/api';

/**
 * Pure helpers behind the abuse-report flow.
 *
 * These live outside the hook on purpose: the consent gate is the one piece of
 * this feature where a bug leaks plaintext out of an end-to-end encrypted app,
 * so it belongs in a function that can be tested directly rather than inline
 * in a component.
 */

/** How many of the peer's recent messages we offer as report evidence. */
export const MAX_EVIDENCE = 20;

interface EvidenceCandidate {
  id: string;
  senderId: string;
  content: string;
  timestamp: string;
  deletedAt: string | null;
}

/**
 * The peer's recent, still-visible messages, oldest→newest.
 *
 * Excludes the reporter's own messages (you report what was sent TO you),
 * tombstoned messages, and empty bodies — a media message whose content is a
 * pointer decrypts to an empty string and would be noise for a moderator.
 */
export function buildEvidence(
  messages: EvidenceCandidate[],
  senderId: string,
): ReportEvidenceMessage[] {
  return messages
    .filter(
      (m) =>
        m.senderId !== senderId &&
        !m.deletedAt &&
        typeof m.content === 'string' &&
        m.content.length > 0,
    )
    .slice(-MAX_EVIDENCE)
    .map((m) => ({
      message_id: m.id,
      sent_at: m.timestamp,
      content: m.content,
    }));
}

/**
 * Assemble the POST /reports body, enforcing the consent gate.
 *
 * When the user has not consented, `messages` is emptied HERE — before the
 * request is built — so plaintext never leaves the device. The server drops
 * unconsented payloads too, but relying on that alone would mean the content
 * had already been transmitted.
 */
export function buildReportBody(args: {
  userId: string;
  reason: ReportReason;
  details: string;
  conversationId: string;
  includeMessages: boolean;
  evidence: ReportEvidenceMessage[];
}): ReportBody {
  return {
    user_id: args.userId,
    reason: args.reason,
    details: args.details.trim() || undefined,
    conversation_id: args.conversationId,
    include_messages: args.includeMessages,
    messages: args.includeMessages ? args.evidence : [],
  };
}
