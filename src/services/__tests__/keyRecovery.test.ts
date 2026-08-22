/**
 * Tests for the split-derivation key recovery crypto.
 * scrypt N=2^14 makes each deriveKeyMaterial ~50-100ms, so keep derivations few.
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {
  deriveKeyMaterial,
  wrapSecretKey,
  unwrapSecretKey,
} from '../keyRecovery';

const NUM_A = '4783874301';
const NUM_B = '1112223334';

describe('keyRecovery split-derivation', () => {
  it('recovers the identical secret key on a fresh device (same password + number)', async () => {
    const secretKeyB64 = naclUtil.encodeBase64(nacl.box.keyPair().secretKey);

    // device 1: register — wrap under the login password's wrap key
    const reg = await deriveKeyMaterial('correct horse battery staple', NUM_A);
    const backup = wrapSecretKey(secretKeyB64, reg.wrapKey);

    // device 2: login — same password + number re-derives the same wrap key
    const login = await deriveKeyMaterial('correct horse battery staple', NUM_A);
    expect(login.authVerifier).toBe(reg.authVerifier); // server can authenticate
    expect(unwrapSecretKey(backup, login.wrapKey)).toBe(secretKeyB64); // history decrypts
  });

  it('keeps the auth verifier independent from the wrap key (server cannot derive it)', async () => {
    const mat = await deriveKeyMaterial('pw', NUM_A);
    expect(mat.authVerifier).not.toBe(naclUtil.encodeBase64(mat.wrapKey));
    expect(mat.authVerifier).toMatch(/^[0-9a-f]{64}$/); // 32-byte hex verifier
    expect(mat.wrapKey.length).toBe(32);
  });

  it('fails to unwrap and yields a different verifier under the wrong password', async () => {
    const secretKeyB64 = naclUtil.encodeBase64(nacl.box.keyPair().secretKey);
    const good = await deriveKeyMaterial('right-password', NUM_A);
    const backup = wrapSecretKey(secretKeyB64, good.wrapKey);

    const bad = await deriveKeyMaterial('wrong-password', NUM_A);
    expect(bad.authVerifier).not.toBe(good.authVerifier);
    expect(unwrapSecretKey(backup, bad.wrapKey)).toBeNull();
  });

  it('binds derivation to the private number (salt)', async () => {
    const a = await deriveKeyMaterial('same-password', NUM_A);
    const b = await deriveKeyMaterial('same-password', NUM_B);
    expect(a.authVerifier).not.toBe(b.authVerifier);
  });

  it('returns null on a malformed backup', () => {
    const wrapKey = nacl.randomBytes(32);
    expect(unwrapSecretKey('not json', wrapKey)).toBeNull();
    expect(unwrapSecretKey('{"v":2}', wrapKey)).toBeNull();
    expect(unwrapSecretKey('{"v":1,"n":"x"}', wrapKey)).toBeNull();
  });
});
