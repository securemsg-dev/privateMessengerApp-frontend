/**
 * Reducer unit tests for the chat slice — pure state transitions only
 * (thunks talk to the network/SQLite and are covered by manual testing).
 */
import reducer, {
  loadMessagesThunk,
  sendMessageThunk,
  markViewOnceOpened,
  applyReactionEvent,
  clearActiveMessages,
  mediaMetaOf,
  setActiveConversation,
  setPeerPresence,
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
  it('moves ticks forward only', () => {
    let state = stateWith(makeMessage({ status: 'sending' }));
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'read' }));
    expect(state.activeMessages[0].status).toBe('read');

    // A late 'delivered' (or a stray failure) must not undo 'read'.
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'delivered' }));
    expect(state.activeMessages[0].status).toBe('read');
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'failed' }));
    expect(state.activeMessages[0].status).toBe('read');
  });

  it('fails a message that is still sending, and retries only when forced', () => {
    let state = stateWith(makeMessage({ status: 'sending' }));
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'failed' }));
    expect(state.activeMessages[0].status).toBe('failed');

    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'sending' }));
    expect(state.activeMessages[0].status).toBe('failed');
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'sending', force: true }));
    expect(state.activeMessages[0].status).toBe('sending');
  });

  it('a receipt rescues a message wrongly marked failed', () => {
    let state = stateWith(makeMessage({ status: 'failed' }));
    state = reducer(state, updateMessageStatus({ id: 'm1', status: 'delivered' }));
    expect(state.activeMessages[0].status).toBe('delivered');
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


describe('peer presence', () => {
  const online = { userId: 'peer', online: true, lastSeen: null };

  it('stores presence for the open chat', () => {
    const s = reducer(undefined, setPeerPresence(online));
    expect(s.peerPresence).toEqual(online);
  });

  it('clears when the thread is reset or another chat is opened', () => {
    let s = reducer(undefined, setActiveConversation('c1'));
    s = reducer(s, setPeerPresence(online));
    expect(reducer(s, clearActiveMessages()).peerPresence).toBeNull();
    expect(reducer(s, setActiveConversation('c2')).peerPresence).toBeNull();
    // Re-dispatching the same conversation keeps it.
    expect(reducer(s, setActiveConversation('c1')).peerPresence).toEqual(online);
  });
});

describe('mediaMetaOf', () => {
  it('prefers locally-known meta over the envelope', () => {
    const m = makeMessage({
      type: 'voice',
      mediaEnvelope: {
        kind: 'media', blobId: 'b', downloadUrl: 'u', key: 'k', nonce: 'n',
        mime: 'audio/aac', sizeBytes: 1, durationMs: 1000,
      },
      mediaMeta: { durationMs: 2000, waveform: [1, 2] },
    });
    expect(mediaMetaOf(m)).toMatchObject({ durationMs: 2000, waveform: [1, 2] });
    expect(mediaMetaOf(makeMessage())).toEqual({});
  });
});

describe('markViewOnceOpened', () => {
  it('drops the media key and local file once a view-once message is opened', () => {
    const state = stateWith(
      makeMessage({
        type: 'image',
        viewOnce: true,
        openedAt: null,
        mediaUri: 'file:///cache/x.jpg',
        mediaEnvelope: { kind: 'media', blobId: 'b', downloadUrl: 'u', key: 'k', nonce: 'n', mime: 'image/jpeg', sizeBytes: 1 },
      }),
    );
    const next = reducer(
      state,
      markViewOnceOpened({ messageId: 'm1', timestamp: '2026-11-15T00:00:00Z' }),
    );
    expect(next.activeMessages[0].openedAt).toBe('2026-11-15T00:00:00Z');
    expect(next.activeMessages[0].mediaEnvelope).toBeNull();
    expect(next.activeMessages[0].mediaUri).toBeUndefined();
  });
});

describe('chat list stays in step with the open chat', () => {
  const conv = {
    id: 'c1',
    contactName: 'Alice',
    contactPrivateNumber: '1234567890',
    contactProfilePictureKey: null,
    contactPublicKey: null,
    lastMessage: 'Hello',
    lastMessageTime: '2026-06-11T00:00:00Z',
    lastMessageType: 'text',
    unreadCount: 0,
    isSelfChat: false,
  } as any;
  const withConv = (messages: Message[] = []) => ({
    ...reducer(undefined, { type: '@@init' }),
    conversations: [conv],
    activeMessages: messages,
  });

  it('shows my own message in the list as soon as it is sent', () => {
    const mine = makeMessage({
      id: 't1', conversationId: 'c1', content: 'Latest msg', timestamp: '2026-06-11T00:01:00Z',
    });
    const next = reducer(withConv(), { type: sendMessageThunk.fulfilled.type, payload: mine });
    expect(next.conversations[0].lastMessage).toBe('Latest msg');
    expect(next.conversations[0].lastMessageTime).toBe('2026-06-11T00:01:00Z');
  });

  it('shows a message received in the open chat, with a media label', () => {
    const photo = makeMessage({
      id: 's9', conversationId: 'c1', senderId: 'peer', type: 'image',
      content: 'Photo', timestamp: '2026-06-11T00:02:00Z',
    });
    const next = reducer(withConv(), upsertMessage({ message: photo }));
    expect(next.conversations[0].lastMessage).toBe('📷 Photo');
    expect(next.conversations[0].lastMessageSenderId).toBe('peer');
  });

  it('never moves the preview back to an older message', () => {
    const old = makeMessage({
      id: 's1', conversationId: 'c1', content: 'old', timestamp: '2026-06-10T00:00:00Z',
    });
    const next = reducer(withConv(), upsertMessage({ message: old }));
    expect(next.conversations[0].lastMessage).toBe('Hello');
  });
});

describe('sendMessage optimistic row', () => {
  const arg = {
    id: 'local1',
    conversationId: 'c1',
    senderId: 'me',
    receiverId: 'them',
    content: 'hi',
    type: 'text' as const,
    pending: true,
  };
  const pending = () => sendMessageThunk.pending('req1', arg);
  const fulfilled = () =>
    sendMessageThunk.fulfilled(
      makeMessage({ id: 'local1', content: 'hi', status: 'sending' }),
      'req1',
      arg,
    );

  it('is in the thread the moment it is dispatched', () => {
    const next = reducer(stateWith(), pending());
    expect(next.activeMessages).toHaveLength(1);
    expect(next.activeMessages[0]).toMatchObject({ id: 'local1', status: 'sending' });
  });

  it('a failure reported before the local save finishes stays failed', () => {
    let s = reducer(stateWith(), pending());
    s = reducer(s, updateMessageStatus({ id: 'local1', status: 'failed' }));
    s = reducer(s, fulfilled());
    expect(s.activeMessages).toHaveLength(1);
    expect(s.activeMessages[0].status).toBe('failed');
  });

  it('an echo that beats the local save confirms the row instead of duplicating it', () => {
    let s = reducer(stateWith(), pending());
    s = reducer(
      s,
      upsertMessage({
        message: makeMessage({ id: 'server-1', content: 'hi', status: 'sent' }),
        matchClientTempId: 'local1',
      }),
    );
    s = reducer(s, fulfilled());
    expect(s.activeMessages).toHaveLength(1);
    expect(s.activeMessages[0]).toMatchObject({ id: 'local1', status: 'sent' });
  });
});

describe('loadMessages keeps media already on screen', () => {
  it('carries downloaded files over to the fresh server page', () => {
    const cached = makeMessage({ id: 'p1', type: 'image', mediaUri: 'file:///cache/p1.jpg' });
    const state = { ...stateWith(cached) };
    const fresh = makeMessage({ id: 'p1', type: 'image', mediaUri: undefined, status: 'read' });
    const next = reducer(state, {
      type: loadMessagesThunk.fulfilled.type,
      payload: { messages: [fresh, makeMessage({ id: 'p2' })], nextCursor: null },
    });
    expect(next.activeMessages[0].mediaUri).toBe('file:///cache/p1.jpg');
    expect(next.activeMessages[0].status).toBe('read');
    expect(next.activeMessages[1].mediaUri).toBeUndefined();
  });
});
