import {
  buildEvidence,
  buildReportBody,
  MAX_EVIDENCE,
} from '../reportEvidence';

/**
 * The consent gate is the security-critical part of the report flow: Cricchat
 * is end-to-end encrypted, so these functions decide whether readable message
 * content ever leaves the device.
 */

const msg = (over: Partial<Parameters<typeof buildEvidence>[0][0]> = {}) => ({
  id: 'm1',
  senderId: 'peer',
  content: 'hello',
  timestamp: '2026-07-25T10:00:00Z',
  deletedAt: null,
  ...over,
});

describe('buildEvidence', () => {
  it('keeps only the peer\'s messages', () => {
    const out = buildEvidence(
      [
        msg({ id: 'a', senderId: 'peer', content: 'from them' }),
        msg({ id: 'b', senderId: 'me', content: 'from me' }),
      ],
      'me',
    );
    expect(out.map((e) => e.message_id)).toEqual(['a']);
  });

  it('skips deleted and empty messages', () => {
    const out = buildEvidence(
      [
        msg({ id: 'a', deletedAt: '2026-07-25T11:00:00Z' }),
        msg({ id: 'b', content: '' }),
        msg({ id: 'c', content: 'real' }),
      ],
      'me',
    );
    expect(out.map((e) => e.message_id)).toEqual(['c']);
  });

  it('caps at MAX_EVIDENCE, keeping the most recent', () => {
    const many = Array.from({ length: MAX_EVIDENCE + 5 }, (_, i) =>
      msg({ id: `m${i}`, content: `body ${i}` }),
    );
    const out = buildEvidence(many, 'me');
    expect(out).toHaveLength(MAX_EVIDENCE);
    // The tail is what a moderator cares about — most recent messages kept.
    expect(out[out.length - 1].message_id).toBe(`m${MAX_EVIDENCE + 4}`);
  });

  it('carries the decrypted content through when consent is later given', () => {
    const out = buildEvidence([msg({ content: 'abusive text' })], 'me');
    expect(out[0].content).toBe('abusive text');
  });
});

describe('buildReportBody consent gate', () => {
  const evidence = [
    { message_id: 'a', sent_at: '2026-07-25T10:00:00Z', content: 'secret' },
  ];

  const base = {
    userId: 'user-1',
    reason: 'harassment' as const,
    details: '  they kept messaging me  ',
    conversationId: 'conv-1',
    evidence,
  };

  it('omits message content entirely when the user did not consent', () => {
    const body = buildReportBody({ ...base, includeMessages: false });
    expect(body.include_messages).toBe(false);
    expect(body.messages).toEqual([]);
    // Belt and braces: the plaintext must not appear anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('includes message content when the user consented', () => {
    const body = buildReportBody({ ...base, includeMessages: true });
    expect(body.include_messages).toBe(true);
    expect(body.messages).toEqual(evidence);
  });

  it('trims details and drops them when blank', () => {
    expect(buildReportBody({ ...base, includeMessages: false }).details).toBe(
      'they kept messaging me',
    );
    expect(
      buildReportBody({ ...base, details: '   ', includeMessages: false })
        .details,
    ).toBeUndefined();
  });

  it('always carries the reported user and conversation', () => {
    const body = buildReportBody({ ...base, includeMessages: true });
    expect(body.user_id).toBe('user-1');
    expect(body.conversation_id).toBe('conv-1');
    expect(body.reason).toBe('harassment');
  });
});
