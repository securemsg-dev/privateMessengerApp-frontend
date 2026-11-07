/**
 * Unit tests for the E2EE layer (services/crypto.ts).
 *
 * "Us" = the module under test (keypair persisted via the mocked SecureStore).
 * "Peer" = a raw tweetnacl keypair we drive by hand to simulate the other side.
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

import {
  decryptGroupMessage,
  encryptGroupMessage,
  isGroupEnvelope,
  MissingRecipientKeyError,
  decryptBytes,
  decryptMessage,
  decryptOrFallback,
  encryptBytes,
  encryptMessage,
  getKeyPair,
  getPublicKey,
  makeMediaKey,
  parseMediaEnvelope,
} from '../crypto';

describe('keypair lifecycle', () => {
  it('generates a stable keypair and returns the same one on later calls', async () => {
    const first = await getKeyPair();
    const second = await getKeyPair();
    expect(first).toEqual(second);
    expect(naclUtil.decodeBase64(first.publicKey)).toHaveLength(32);
    expect(naclUtil.decodeBase64(first.secretKey)).toHaveLength(32);
    expect(await getPublicKey()).toBe(first.publicKey);
  });
});

describe('message encryption (nacl.box)', () => {
  const peer = nacl.box.keyPair();
  const peerPublicB64 = naclUtil.encodeBase64(peer.publicKey);

  it('encrypts so that only the peer (or us) can open it', async () => {
    const envelopeJson = await encryptMessage('hello world 🌍', peerPublicB64);
    const envelope = JSON.parse(envelopeJson);
    expect(envelope.v).toBe(1);

    // Peer opens it with their secret key + our public key.
    const myPublic = naclUtil.decodeBase64(await getPublicKey());
    const opened = nacl.box.open(
      naclUtil.decodeBase64(envelope.c),
      naclUtil.decodeBase64(envelope.n),
      myPublic,
      peer.secretKey,
    );
    expect(opened).not.toBeNull();
    expect(naclUtil.encodeUTF8(opened!)).toBe('hello world 🌍');
  });

  it('round-trips a message the peer sent to us', async () => {
    const myPublic = naclUtil.decodeBase64(await getPublicKey());
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const cipher = nacl.box(
      naclUtil.decodeUTF8('reply from peer'),
      nonce,
      myPublic,
      peer.secretKey,
    );
    const envelopeJson = JSON.stringify({
      v: 1,
      n: naclUtil.encodeBase64(nonce),
      c: naclUtil.encodeBase64(cipher),
    });

    expect(await decryptMessage(envelopeJson, peerPublicB64)).toBe('reply from peer');
  });

  it('uses a fresh nonce per message', async () => {
    const a = JSON.parse(await encryptMessage('same text', peerPublicB64));
    const b = JSON.parse(await encryptMessage('same text', peerPublicB64));
    expect(a.n).not.toBe(b.n);
    expect(a.c).not.toBe(b.c);
  });

  it('returns null for tampered ciphertext', async () => {
    const envelope = JSON.parse(await encryptMessage('secret', peerPublicB64));
    const cipher = naclUtil.decodeBase64(envelope.c);
    cipher[0] ^= 0xff;
    envelope.c = naclUtil.encodeBase64(cipher);
    expect(await decryptMessage(JSON.stringify(envelope), peerPublicB64)).toBeNull();
  });

  it('returns null for the wrong peer key and for garbage input', async () => {
    const envelopeJson = await encryptMessage('secret', peerPublicB64);
    const stranger = nacl.box.keyPair();
    const strangerB64 = naclUtil.encodeBase64(stranger.publicKey);
    expect(await decryptMessage(envelopeJson, strangerB64)).toBeNull();
    expect(await decryptMessage('not json', peerPublicB64)).toBeNull();
    expect(await decryptMessage('{"v":2,"n":"x","c":"y"}', peerPublicB64)).toBeNull();
  });
});

describe('decryptOrFallback', () => {
  const peer = nacl.box.keyPair();
  const peerPublicB64 = naclUtil.encodeBase64(peer.publicKey);

  it('passes plain text (Phase A messages) through untouched', async () => {
    expect(await decryptOrFallback('just plain text', peerPublicB64)).toBe(
      'just plain text',
    );
  });

  it('shows a locked placeholder when the peer key is unknown', async () => {
    const envelopeJson = await encryptMessage('secret', peerPublicB64);
    expect(await decryptOrFallback(envelopeJson, null)).toBe('🔒 Encrypted message');
  });

  it('shows a cannot-decrypt placeholder for undecryptable envelopes', async () => {
    const stranger = nacl.box.keyPair();
    const envelopeJson = await encryptMessage(
      'secret',
      naclUtil.encodeBase64(stranger.publicKey),
    );
    // Envelope was encrypted for a stranger; the peer key won't open it.
    expect(await decryptOrFallback(envelopeJson, peerPublicB64)).toBe(
      '🔒 Cannot decrypt',
    );
  });
});

describe('media encryption (nacl.secretbox)', () => {
  it('round-trips bytes and rejects tampering', () => {
    const { key, nonce } = makeMediaKey();
    expect(key).toHaveLength(32);
    expect(nonce).toHaveLength(24);

    const plain = Uint8Array.from([1, 2, 3, 42, 255, 0, 7]);
    const cipher = encryptBytes(plain, key, nonce);
    expect(decryptBytes(cipher, key, nonce)).toEqual(plain);

    cipher[1] ^= 0xff;
    expect(decryptBytes(cipher, key, nonce)).toBeNull();
  });
});

describe('parseMediaEnvelope', () => {
  const valid = {
    kind: 'media',
    blobId: 'b1',
    downloadUrl: 'https://x/media/b1',
    key: 'a2V5',
    nonce: 'bm9uY2U=',
    mime: 'image/jpeg',
    sizeBytes: 123,
  };

  it('accepts a well-formed envelope', () => {
    expect(parseMediaEnvelope(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects plain text, malformed JSON, and missing fields', () => {
    expect(parseMediaEnvelope('hello')).toBeNull();
    expect(parseMediaEnvelope('{broken')).toBeNull();
    expect(parseMediaEnvelope(JSON.stringify({ ...valid, kind: 'text' }))).toBeNull();
    const { key: _key, ...withoutKey } = valid;
    expect(parseMediaEnvelope(JSON.stringify(withoutKey))).toBeNull();
    expect(
      parseMediaEnvelope(JSON.stringify({ ...valid, sizeBytes: '123' })),
    ).toBeNull();
  });

  it('keeps well-formed display metadata (voice duration + waveform, dimensions)', () => {
    const withMeta = { ...valid, durationMs: 12_345, waveform: [0, 10, 31], w: 1600, h: 1200 };
    expect(parseMediaEnvelope(JSON.stringify(withMeta))).toEqual(withMeta);
  });

  it('drops malformed metadata but still accepts the envelope', () => {
    const parsed = parseMediaEnvelope(
      JSON.stringify({
        ...valid,
        durationMs: -5,
        waveform: 'loud',
        w: 1600, // h missing → dimensions dropped as a pair
        poster: 42,
        extra: 'ignored',
      }),
    );
    expect(parsed).toEqual(valid);
  });
});


describe('group messages (envelope v2)', () => {
  const bob = nacl.box.keyPair();
  const carol = nacl.box.keyPair();
  const b64 = naclUtil.encodeBase64;

  /** Open a v2 envelope as a raw member (secret key in hand). */
  const openAs = (envelopeJson: string, userId: string, secret: Uint8Array, senderPub: Uint8Array) => {
    const env = JSON.parse(envelopeJson);
    const packed = naclUtil.decodeBase64(env.k[userId]);
    const key = nacl.box.open(packed.subarray(24), packed.subarray(0, 24), senderPub, secret);
    if (!key) return null;
    const plain = nacl.secretbox.open(naclUtil.decodeBase64(env.c), naclUtil.decodeBase64(env.n), key);
    return plain ? naclUtil.encodeUTF8(plain) : null;
  };

  it('wraps one message key per member, including the sender', async () => {
    const me = await getPublicKey();
    const json = await encryptGroupMessage('hi group 👋', [
      { userId: 'me', publicKey: me },
      { userId: 'bob', publicKey: b64(bob.publicKey) },
      { userId: 'carol', publicKey: b64(carol.publicKey) },
    ]);
    expect(isGroupEnvelope(json)).toBe(true);
    expect(Object.keys(JSON.parse(json).k).sort()).toEqual(['bob', 'carol', 'me']);

    const myPub = naclUtil.decodeBase64(me);
    expect(openAs(json, 'bob', bob.secretKey, myPub)).toBe('hi group 👋');
    expect(openAs(json, 'carol', carol.secretKey, myPub)).toBe('hi group 👋');
    // Sender reads their own message back (history on any device).
    expect(await decryptGroupMessage(json, 'me', me)).toBe('hi group 👋');
  });

  it('decrypts a message another member sent to us', async () => {
    const me = await getPublicKey();
    const messageKey = nacl.randomBytes(32);
    const n = nacl.randomBytes(24);
    const wn = nacl.randomBytes(24);
    const wrapped = nacl.box(messageKey, wn, naclUtil.decodeBase64(me), bob.secretKey);
    const packed = new Uint8Array(24 + wrapped.length);
    packed.set(wn, 0);
    packed.set(wrapped, 24);
    const json = JSON.stringify({
      v: 2,
      n: b64(n),
      c: b64(nacl.secretbox(naclUtil.decodeUTF8('from bob'), n, messageKey)),
      k: { me: b64(packed) },
    });
    expect(await decryptGroupMessage(json, 'me', b64(bob.publicKey))).toBe('from bob');
    // Wrong sender key → can't unwrap.
    expect(await decryptGroupMessage(json, 'me', b64(carol.publicKey))).toBeNull();
  });

  it('returns null for non-members and tampered payloads', async () => {
    const me = await getPublicKey();
    const json = await encryptGroupMessage('secret', [
      { userId: 'me', publicKey: me },
      { userId: 'bob', publicKey: b64(bob.publicKey) },
    ]);
    expect(await decryptGroupMessage(json, 'carol', me)).toBeNull(); // not wrapped for carol
    const env = JSON.parse(json);
    env.c = b64(nacl.randomBytes(naclUtil.decodeBase64(env.c).length));
    expect(await decryptGroupMessage(JSON.stringify(env), 'me', me)).toBeNull();
    expect(await decryptGroupMessage('{"v":1,"n":"x","c":"y"}', 'me', me)).toBeNull();
    expect(await decryptGroupMessage('not json', 'me', me)).toBeNull();
  });

  it('refuses to encrypt when a member has no key', async () => {
    await expect(
      encryptGroupMessage('x', [{ userId: 'bob', publicKey: null }]),
    ).rejects.toBeInstanceOf(MissingRecipientKeyError);
  });

  it('is not mistaken for a 1:1 envelope', () => {
    expect(isGroupEnvelope('{"v":1,"n":"a","c":"b"}')).toBe(false);
    expect(isGroupEnvelope('hello')).toBe(false);
  });
});
