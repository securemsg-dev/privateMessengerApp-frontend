/**
 * services/keyRecovery.ts
 * ────────────────────────
 * Split-derivation key recovery — lets a user restore their E2EE private key
 * (and thus decrypt history) after signing in on a new device, WITHOUT the
 * server ever being able to decrypt it.
 *
 * How the split works, from the real password P and the user's private number:
 *
 *   salt    = SHA256("cricchat-kdf-salt-v1|" + privateNumber)   // recomputable
 *   master  = scrypt(P, salt)                                    // slow, memory-hard
 *   verifier = HKDF(master, info="auth")   → sent to the server (it bcrypt-
 *              hashes this exactly like it used to hash the raw password)
 *   wrapKey  = HKDF(master, info="wrap")   → NEVER leaves the device; encrypts
 *              the private-key backup
 *
 * Because HKDF is one-way and the two infos are independent, a server that
 * sees `verifier` cannot derive `wrapKey`, so it cannot open the backup. The
 * salt is derived from the private number (which the user types at login), so
 * everything is recomputable on a fresh device from just number + password.
 *
 * The private number is used as the salt input, so it must be known before
 * deriving — at registration the client gets it from POST /auth/register/begin.
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { scryptAsync } from '@noble/hashes/scrypt';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';

// scrypt cost. N=2^14 → ~16 MB, ~50-100 ms on a modern phone: enough work to
// make offline guessing expensive, light enough for low-end devices. Bump the
// version tag below (never these numbers silently) if this ever changes, since
// old backups were wrapped under the old parameters.
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MASTER_LEN = 32;

const SALT_PREFIX = 'cricchat-kdf-salt-v1|';
const INFO_AUTH = utf8ToBytes('cricchat-auth-v1');
const INFO_WRAP = utf8ToBytes('cricchat-wrap-v1');

export interface KeyMaterial {
  /** Hex verifier sent to the server in place of the raw password. */
  authVerifier: string;
  /** 32-byte symmetric key for wrapping the private-key backup. Never sent. */
  wrapKey: Uint8Array;
}

/** SHA-256(salt_prefix || privateNumber) — the per-user KDF salt. */
function deriveSalt(privateNumber: string): Uint8Array {
  return sha256(utf8ToBytes(SALT_PREFIX + privateNumber));
}

/**
 * Run the split KDF. Returns the server-facing auth verifier and the local
 * wrap key. `privateNumber` is the salt input, so it must match the value used
 * at registration (the 10-digit number).
 */
export async function deriveKeyMaterial(
  password: string,
  privateNumber: string,
): Promise<KeyMaterial> {
  const salt = deriveSalt(privateNumber);
  const master = await scryptAsync(utf8ToBytes(password), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: MASTER_LEN,
  });
  const authVerifier = bytesToHex(hkdf(sha256, master, salt, INFO_AUTH, 32));
  const wrapKey = hkdf(sha256, master, salt, INFO_WRAP, 32);
  return { authVerifier, wrapKey };
}

interface KeyBackupEnvelope {
  v: 1;
  n: string; // base64 nonce
  c: string; // base64 secretbox ciphertext
}

/**
 * Encrypt the base64 secret key under `wrapKey` (NaCl secretbox) and return a
 * compact JSON envelope suitable for `encrypted_key_backup`.
 */
export function wrapSecretKey(secretKeyB64: string, wrapKey: Uint8Array): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const cipher = nacl.secretbox(naclUtil.decodeBase64(secretKeyB64), nonce, wrapKey);
  const envelope: KeyBackupEnvelope = {
    v: 1,
    n: naclUtil.encodeBase64(nonce),
    c: naclUtil.encodeBase64(cipher),
  };
  return JSON.stringify(envelope);
}

/**
 * Reverse of `wrapSecretKey`. Returns the base64 secret key, or null if the
 * backup is malformed or the wrap key is wrong (wrong password).
 */
export function unwrapSecretKey(backupJson: string, wrapKey: Uint8Array): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    return null;
  }
  const env = parsed as Partial<KeyBackupEnvelope>;
  if (!env || env.v !== 1 || typeof env.n !== 'string' || typeof env.c !== 'string') {
    return null;
  }
  try {
    const opened = nacl.secretbox.open(
      naclUtil.decodeBase64(env.c),
      naclUtil.decodeBase64(env.n),
      wrapKey,
    );
    return opened ? naclUtil.encodeBase64(opened) : null;
  } catch {
    return null;
  }
}
