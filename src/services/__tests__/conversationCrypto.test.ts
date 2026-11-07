import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

import { encryptGroupMessage, encryptMessage, getPublicKey } from '../crypto';
import {
  canEncrypt,
  decryptFor,
  encryptFor,
  EncryptionUnavailableError,
} from '../conversationCrypto';
import { conversationFromDTO, cryptoConvOf } from '../../store/slices/chatSlice';
import type { ConversationDTO } from '../api';

const b64 = naclUtil.encodeBase64;
const bob = nacl.box.keyPair();

describe('conversationCrypto', () => {
  it('describes system messages without decrypting', async () => {
    const text = await decryptFor(
      { isGroup: true, peerPublicKey: null, members: [] },
      {
        payload: JSON.stringify({ event: 'member_left', actor_id: 'b', actor_name: 'Bob' }),
        messageType: 'system',
        senderId: 'b',
      },
      'me',
    );
    expect(text).toBe('Bob left');
  });

  it('round-trips a group message through encryptFor / decryptFor', async () => {
    const me = await getPublicKey();
    const conv = {
      isGroup: true,
      peerPublicKey: null,
      members: [
        { userId: 'me', publicKey: me },
        { userId: 'bob', publicKey: b64(bob.publicKey) },
      ],
    };
    const payload = await encryptFor(conv, 'hello group');
    // Our own message, decrypted via the member list (no sender key on the event).
    expect(await decryptFor(conv, { payload, messageType: 'text', senderId: 'me' }, 'me')).toBe('hello group');
  });

  it('uses the 1:1 peer key for v1 envelopes', async () => {
    const conv = { isGroup: false, peerPublicKey: b64(bob.publicKey), members: [] };
    const payload = await encryptMessage('hi bob', b64(bob.publicKey));
    expect(await decryptFor(conv, { payload, messageType: 'text', senderId: 'me' }, 'me')).toBe('hi bob');
  });

  it("can't read a group message that wasn't wrapped for us", async () => {
    const payload = await encryptGroupMessage('secret', [{ userId: 'bob', publicKey: b64(bob.publicKey) }]);
    const text = await decryptFor(
      { isGroup: true, peerPublicKey: null, members: [] },
      { payload, messageType: 'text', senderId: 'bob', senderPublicKey: b64(bob.publicKey) },
      'me',
    );
    expect(text).toBe('🔒 Cannot decrypt');
  });

  it('refuses to encrypt without keys', async () => {
    const noPeer = { isGroup: false, peerPublicKey: null, members: [] };
    const emptyGroup = { isGroup: true, peerPublicKey: null, members: [] };
    expect(canEncrypt(noPeer)).toBe(false);
    expect(canEncrypt(emptyGroup)).toBe(false);
    expect(canEncrypt({ isGroup: true, peerPublicKey: null, members: [{ userId: 'x', publicKey: null }] })).toBe(false);
    await expect(encryptFor(noPeer, 'x')).rejects.toBeInstanceOf(EncryptionUnavailableError);
    await expect(encryptFor(emptyGroup, 'x')).rejects.toBeInstanceOf(EncryptionUnavailableError);
  });
});

describe('conversationFromDTO', () => {
  const base = {
    created_at: '2026-11-01T00:00:00Z',
    unread_count: 2,
    is_pinned: false,
    mute_until: null,
    manual_unread: false,
  };

  it('maps a group: name, members, role, system preview, no peer', async () => {
    const dto: ConversationDTO = {
      ...base,
      id: 'g1',
      is_group: true,
      name: 'Family',
      other_participant: null,
      my_role: 'admin',
      participants: [
        { id: 'me', display_name: 'Me', profile_picture_key: null, public_key: 'k1', role: 'admin' },
        { id: 'bob', display_name: 'Bob', profile_picture_key: null, public_key: 'k2', role: 'member' },
      ],
      last_message: {
        id: 'm1',
        sender_id: 'me',
        message_type: 'system',
        encrypted_payload: JSON.stringify({
          event: 'group_created', actor_id: 'me', actor_name: 'Me', name: 'Family',
        }),
        created_at: '2026-11-02T00:00:00Z',
        self_destruct: false,
      },
    };
    const conv = await conversationFromDTO(dto, 'me');
    expect(conv).toMatchObject({
      id: 'g1',
      isGroup: true,
      contactName: 'Family',
      contactPrivateNumber: '',
      myRole: 'admin',
      lastMessage: 'You created the group “Family”',
      lastMessageType: 'system',
      unreadCount: 2,
    });
    expect(conv.members?.map((m) => [m.userId, m.role])).toEqual([['me', 'admin'], ['bob', 'member']]);
    expect(cryptoConvOf(conv)).toEqual({
      isGroup: true,
      peerPublicKey: null,
      members: [
        { userId: 'me', publicKey: 'k1' },
        { userId: 'bob', publicKey: 'k2' },
      ],
    });
  });

  it('maps a 1:1 chat with the peer id for presence/safety', async () => {
    const conv = await conversationFromDTO(
      {
        ...base,
        id: 'c1',
        is_group: false,
        name: null,
        last_message: null,
        other_participant: {
          id: 'bob', private_number: '1234567890', display_name: 'Bob', bio: null,
          public_key: 'kb', profile_picture_key: null,
        },
      },
      'me',
    );
    expect(conv).toMatchObject({ isGroup: false, peerUserId: 'bob', contactPublicKey: 'kb', contactName: 'Bob' });
    expect(cryptoConvOf(conv).peerPublicKey).toBe('kb');
  });
});
