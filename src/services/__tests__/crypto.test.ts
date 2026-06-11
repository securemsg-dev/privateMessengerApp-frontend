/**
 * Unit tests for the E2EE layer (services/crypto.ts).
 *
 * "Us" = the module under test (keypair persisted via the mocked SecureStore).
 * "Peer" = a raw tweetnacl keypair we drive by hand to simulate the other side.
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

import {
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
});
