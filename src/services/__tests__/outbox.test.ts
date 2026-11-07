import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

import { getPublicKey } from '../crypto';
import { Outbox } from '../outbox';
import type { Conversation } from '../../store/slices/chatSlice';

const b64 = naclUtil.encodeBase64;

function setup(opts: { refreshed?: Partial<Conversation> | null } = {}) {
  const sent: any[] = [];
  const actions: any[] = [];
  const socket = { send: (f: unknown) => sent.push(f) } as any;
  const dispatch = jest.fn((action: any) => {
    if (typeof action === 'function') {
      // refreshConversationThunk → resolve with the "server" state.
      return {
        unwrap: async () => ({
          id: 'g1',
          conversation: opts.refreshed === null ? null : (opts.refreshed as Conversation),
        }),
      };
    }
    actions.push(action);
    return action;
  });
  return { sent, actions, socket, dispatch };
}

describe('Outbox', () => {
  const bob = nacl.box.keyPair();
  const carol = nacl.box.keyPair();

  it('re-encrypts for the new member list once after group_members_changed', async () => {
    const me = await getPublicKey();
    const refreshed: Partial<Conversation> = {
      id: 'g1',
      isGroup: true,
      members: [
        { userId: 'me', publicKey: me, displayName: null, profilePictureKey: null, role: 'admin' },
        { userId: 'bob', publicKey: b64(bob.publicKey), displayName: null, profilePictureKey: null, role: 'member' },
        { userId: 'carol', publicKey: b64(carol.publicKey), displayName: null, profilePictureKey: null, role: 'member' },
      ],
    };
    const { sent, actions, socket, dispatch } = setup({ refreshed });
    const outbox = new Outbox({
      conversationId: 'g1',
      dispatch: dispatch as any,
      socket: () => socket,
      crypto: () => ({
        isGroup: true,
        peerPublicKey: null,
        members: [
          { userId: 'me', publicKey: me },
          { userId: 'bob', publicKey: b64(bob.publicKey) },
        ],
      }),
    });

    await outbox.send('t1', 'hello', { message_type: 'text' });
    expect(Object.keys(JSON.parse(sent[0].encrypted_payload).k).sort()).toEqual(['bob', 'me']);

    await outbox.handleError({ type: 'error', detail: 'x', code: 'group_members_changed', client_temp_id: 't1' });
    expect(sent).toHaveLength(2);
    expect(sent[1].client_temp_id).toBe('t1');
    expect(Object.keys(JSON.parse(sent[1].encrypted_payload).k).sort()).toEqual(['bob', 'carol', 'me']);
    expect(actions).toEqual([]); // not marked failed

    // A second rejection gives up and marks the message failed.
    await outbox.handleError({ type: 'error', detail: 'x', code: 'group_members_changed', client_temp_id: 't1' });
    expect(sent).toHaveLength(2);
    expect(actions[0]).toMatchObject({ payload: { id: 't1', status: 'failed' } });
  });

  it('marks a message failed on any other error that names it', async () => {
    const { actions, socket, dispatch } = setup();
    const outbox = new Outbox({
      conversationId: 'c1',
      dispatch: dispatch as any,
      socket: () => socket,
      crypto: () => ({ isGroup: false, peerPublicKey: b64(bob.publicKey), members: [] }),
    });
    await outbox.send('t2', 'hi', { message_type: 'text' });
    await outbox.handleError({ type: 'error', detail: 'media_blob_id not found', client_temp_id: 't2' });
    expect(actions[0]).toMatchObject({ payload: { id: 't2', status: 'failed' } });

    // Errors without a temp id are not about a specific message.
    await outbox.handleError({ type: 'error', detail: 'Rate limit exceeded' });
    expect(actions).toHaveLength(1);
  });

  it('forgets acknowledged messages', async () => {
    const { actions, socket, dispatch } = setup();
    const outbox = new Outbox({
      conversationId: 'c1',
      dispatch: dispatch as any,
      socket: () => socket,
      crypto: () => ({ isGroup: false, peerPublicKey: b64(bob.publicKey), members: [] }),
    });
    await outbox.send('t3', 'hi', { message_type: 'text' });
    outbox.ack('t3');
    await outbox.handleError({ type: 'error', detail: 'x', code: 'group_members_changed', client_temp_id: 't3' });
    // No pending entry → straight to failed (nothing to resend).
    expect(actions[0]).toMatchObject({ payload: { id: 't3', status: 'failed' } });
  });
});
