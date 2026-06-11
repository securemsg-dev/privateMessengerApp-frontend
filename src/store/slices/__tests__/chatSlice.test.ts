/**
 * Reducer unit tests for the chat slice — pure state transitions only
 * (thunks talk to the network/SQLite and are covered by manual testing).
 */
import reducer, {
  applyReactionEvent,
  markMessageDeletedForEveryone,
  Message,
  removeMessage,
  setMessageStarred,
  updateMessageStatus,
  upsertMessage,
} from '../chatSlice';

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: 'me',
  receiverId: 'them',
  content: 'hello',
  type: 'text',
  timestamp: '2026-06-11T00:00:00Z',
  status: 'sent',
  reactions: [],
  isStarred: false,
  replyToId: null,
  replyPreview: null,
  deletedAt: null,
  deletedBy: null,
  mediaEnvelope: null,
  ...overrides,
});

const stateWith = (...messages: Message[]) => ({
  ...reducer(undefined, { type: '@@init' }),
  activeMessages: messages,
});

describe('upsertMessage', () => {
  it('appends a brand-new message', () => {
    const next = reducer(stateWith(), upsertMessage({ message: makeMessage() }));
    expect(next.activeMessages).toHaveLength(1);
    expect(next.activeMessages[0].id).toBe('m1');
  });

  it('reconciles the WS echo onto the optimistic row via matchClientTempId', () => {
    const optimistic = makeMessage({ id: 'temp-1', status: 'sent' });
    const echo = makeMessage({
      id: 'server-uuid',
      timestamp: '2026-06-11T00:00:05Z',
      status: 'delivered',
    });

    const next = reducer(
      stateWith(optimistic),
      upsertMessage({ message: echo, matchClientTempId: 'temp-1' }),
    );

    // Local id survives (stable React keys); server fields are absorbed.
    expect(next.activeMessages).toHaveLength(1);
    expect(next.activeMessages[0].id).toBe('temp-1');
    expect(next.activeMessages[0].timestamp).toBe('2026-06-11T00:00:05Z');
    expect(next.activeMessages[0].status).toBe('delivered');
  });

  it('merges by id when the message already exists', () => {
    const existing = makeMessage({ content: 'old' });
    const next = reducer(
      stateWith(existing),
      upsertMessage({ message: makeMessage({ content: 'new' }) }),
    );
    expect(next.activeMessages).toHaveLength(1);
    expect(next.activeMessages[0].content).toBe('new');
  });
});

describe('updateMessageStatus', () => {
  it('updates ticks, including the failed state', () => {
    let state = stateWith(makeMessage());
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'read' }));
    expect(state.activeMessages[0].status).toBe('read');

    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'failed' }));
    expect(state.activeMessages[0].status).toBe('failed');
  });

  it('ignores unknown message ids', () => {
    const state = stateWith(makeMessage());
    const next = reducer(state, updateMessageStatus({ id: 'nope', status: 'read' }));
    expect(next.activeMessages[0].status).toBe('sent');
  });
});

describe('applyReactionEvent', () => {
  it('adds, stacks, and removes reactions', () => {
    let state = stateWith(makeMessage());

    state = reducer(
      state,
      applyReactionEvent({ messageId: 'm1', emoji: '👍', byMe: true, action: 'added' }),
    );
    expect(state.activeMessages[0].reactions).toEqual([
      { emoji: '👍', count: 1, byMe: true },
    ]);

    state = reducer(
      state,
      applyReactionEvent({ messageId: 'm1', emoji: '👍', byMe: false, action: 'added' }),
    );
    expect(state.activeMessages[0].reactions[0].count).toBe(2);

    state = reducer(
      state,
      applyReactionEvent({ messageId: 'm1', emoji: '👍', byMe: true, action: 'removed' }),
    );
    expect(state.activeMessages[0].reactions[0]).toEqual({
      emoji: '👍',
      count: 1,
      byMe: false,
    });

    state = reducer(
      state,
      applyReactionEvent({ messageId: 'm1', emoji: '👍', byMe: false, action: 'removed' }),
    );
    expect(state.activeMessages[0].reactions).toHaveLength(0);
  });
});

describe('star / delete', () => {
  it('toggles the star flag', () => {
    let state = stateWith(makeMessage());
    state = reducer(state, setMessageStarred({ messageId: 'm1', starred: true }));
    expect(state.activeMessages[0].isStarred).toBe(true);
    state = reducer(state, setMessageStarred({ messageId: 'm1', starred: false }));
    expect(state.activeMessages[0].isStarred).toBe(false);
  });

  it('delete-for-me removes the row locally', () => {
    const state = stateWith(makeMessage(), makeMessage({ id: 'm2' }));
    const next = reducer(state, removeMessage({ messageId: 'm1' }));
    expect(next.activeMessages.map((m) => m.id)).toEqual(['m2']);
  });

  it('delete-for-everyone leaves a tombstone with content/reactions cleared', () => {
    const msg = makeMessage({
      content: 'secret',
      reactions: [{ emoji: '👍', count: 1, byMe: true }],
      replyPreview: { id: 'r', senderId: 's', type: 'text', content: 'q' },
      mediaUri: 'file:///x.jpg',
    });
    const next = reducer(
      stateWith(msg),
      markMessageDeletedForEveryone({
        messageId: 'm1',
        byUserId: 'them',
        timestamp: '2026-06-11T01:00:00Z',
      }),
    );
    const tomb = next.activeMessages[0];
    expect(tomb.deletedAt).toBe('2026-06-11T01:00:00Z');
    expect(tomb.deletedBy).toBe('them');
    expect(tomb.content).toBe('');
    expect(tomb.reactions).toHaveLength(0);
    expect(tomb.replyPreview).toBeNull();
    expect(tomb.mediaUri).toBeUndefined();
  });
});
