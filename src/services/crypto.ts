/**
 * services/crypto.ts
 * ───────────────────
 * Phase B — naive E2EE using tweetnacl's `box` primitive
 * (Curve25519 key agreement + XSalsa20-Poly1305 authenticated encryption).
 *
 * Threat model:
 *   - Server CANNOT read message content (it only sees ciphertext blobs).
 *   - A network observer CANNOT read message content.
 *   - This scheme provides authenticity (Poly1305) and confidentiality.
 *
 * Limitations vs production-grade messengers:
 *   - No forward secrecy: a future compromise of a long-term private key
 *     decrypts ALL past messages. A real deployment would layer on a
 *     Double-Ratchet on top of this. Flagged as TODO for a later phase.
 *   - One long-term key per user (no per-device keys).
 *   - No deniability beyond what NaCl box provides.
 *
 * Wire format (JSON envelope):
 *   { "v": 1, "n": "<base64 24-byte nonce>", "c": "<base64 ciphertext>" }
 *
 * Backward compatibility:
 *   `decryptOrFallback` returns the raw payload as-is when it isn't a valid
 *   envelope, so older Phase A plaintext messages keep rendering correctly.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import * as Crypto from 'expo-crypto';

import * as SecureStore from '../utils/secureStorage';

// ── PRNG: hook tweetnacl into Expo's CSPRNG ──────────────────────────────────
// tweetnacl needs a high-quality random source. We wire it to expo-crypto
// once at module load — every nacl.box / nacl.randomBytes call now sources
// from the platform CSPRNG.
nacl.setPRNG((x, n) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});

// ── Storage keys ─────────────────────────────────────────────────────────────
const SECRET_KEY_STORE = 'e2ee_secret_key';
const PUBLIC_KEY_STORE = 'e2ee_public_key';
// Private number of the user who owns the persisted keypair. Used to detect
// "different user logged in on the same device" and reset the keypair so we
// don't inherit someone else's E2EE identity.
const KEY_OWNER_STORE = 'e2ee_owner';

// In-memory cache (avoids hitting SecureStore on every send/receive)
let cachedKeyPair: { publicKey: string; secretKey: string } | null = null;
let initPromise: Promise<{ publicKey: string; secretKey: string }> | null = null;

// ── Wire envelope ────────────────────────────────────────────────────────────
interface Envelope {
  v: 1;
  n: string;
  c: string;
}

const isEnvelope = (x: unknown): x is Envelope =>
  !!x &&
  typeof x === 'object' &&
  (x as Envelope).v === 1 &&
  typeof (x as Envelope).n === 'string' &&
  typeof (x as Envelope).c === 'string';

// ── Keypair lifecycle ────────────────────────────────────────────────────────

async function loadFromStore(): Promise<{ publicKey: string; secretKey: string } | null> {
  const [pub, sec] = await Promise.all([
    SecureStore.getItemAsync(PUBLIC_KEY_STORE),
    SecureStore.getItemAsync(SECRET_KEY_STORE),
  ]);
  if (!pub || !sec) return null;
  return { publicKey: pub, secretKey: sec };
}

async function persistKeyPair(pair: { publicKey: string; secretKey: string }): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(PUBLIC_KEY_STORE, pair.publicKey),
    SecureStore.setItemAsync(SECRET_KEY_STORE, pair.secretKey),
  ]);
}

/**
 * Returns the user's keypair, generating + persisting one on first call.
 * Subsequent calls hit the in-memory cache. Concurrent callers share a
 * single in-flight init promise (so we don't generate two keypairs in a
 * race between `getKeyPair` calls during boot).
 */
export async function getKeyPair(): Promise<{ publicKey: string; secretKey: string }> {
  if (cachedKeyPair) return cachedKeyPair;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const stored = await loadFromStore();
    if (stored) {
      cachedKeyPair = stored;
      return stored;
    }
    const fresh = nacl.box.keyPair();
    const pair = {
      publicKey: naclUtil.encodeBase64(fresh.publicKey),
      secretKey: naclUtil.encodeBase64(fresh.secretKey),
    };
    await persistKeyPair(pair);
    cachedKeyPair = pair;
    return pair;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

/** Convenience: just the public key (Base64). */
export async function getPublicKey(): Promise<string> {
  const pair = await getKeyPair();
  return pair.publicKey;
}

/**
 * Wipe the keypair from device storage and memory. Called on logout / delete
 * — the next caller of `getKeyPair()` will mint a fresh pair.
 */
export async function clearKeyPair(): Promise<void> {
  cachedKeyPair = null;
  initPromise = null;
  await Promise.all([
    SecureStore.deleteItemAsync(PUBLIC_KEY_STORE),
    SecureStore.deleteItemAsync(SECRET_KEY_STORE),
    SecureStore.deleteItemAsync(KEY_OWNER_STORE),
  ]);
}

/**
 * Bind the on-device keypair to a specific user (their private number). If
 * the existing keypair belongs to a different user, it is wiped first so the
 * next `getKeyPair()` mints a fresh one. Call this once on every successful
 * authentication, before encrypting / decrypting any messages.
 */
export async function ensureKeyPairFor(ownerPrivateNumber: string): Promise<void> {
  const stored = await SecureStore.getItemAsync(KEY_OWNER_STORE);
  if (stored && stored !== ownerPrivateNumber) {
    await clearKeyPair();
  }
  await SecureStore.setItemAsync(KEY_OWNER_STORE, ownerPrivateNumber);
}

/**
 * Mint a brand-new keypair for a just-registered account, replacing anything
 * on the device. Returns the pair so the caller can wrap the secret key into
 * the server-side backup. See services/keyRecovery.ts.
 */
export async function createFreshKeyPair(
  ownerPrivateNumber: string,
): Promise<{ publicKey: string; secretKey: string }> {
  await clearKeyPair();
  const fresh = nacl.box.keyPair();
  const pair = {
    publicKey: naclUtil.encodeBase64(fresh.publicKey),
    secretKey: naclUtil.encodeBase64(fresh.secretKey),
  };
  await persistKeyPair(pair);
  cachedKeyPair = pair;
  await SecureStore.setItemAsync(KEY_OWNER_STORE, ownerPrivateNumber);
  return pair;
}

/**
 * Restore a keypair from a recovered secret key (unwrapped from the server
 * backup on a new-device login). The public key is re-derived from the secret,
 * so a new device recovers the SAME E2EE identity and can decrypt history.
 */
export async function restoreKeyPair(
  secretKeyB64: string,
  ownerPrivateNumber: string,
): Promise<void> {
  const derived = nacl.box.keyPair.fromSecretKey(naclUtil.decodeBase64(secretKeyB64));
  const pair = {
    publicKey: naclUtil.encodeBase64(derived.publicKey),
    secretKey: secretKeyB64,
  };
  await persistKeyPair(pair);
  cachedKeyPair = pair;
  await SecureStore.setItemAsync(KEY_OWNER_STORE, ownerPrivateNumber);
}

// ── Encrypt / decrypt ────────────────────────────────────────────────────────

/**
 * Encrypts `plaintext` for `peerPublicKeyB64` and returns a JSON envelope
 * suitable for the WebSocket `encrypted_payload` field.
 *
 * Throws if peer public key is missing or malformed — caller decides
 * whether to fall through to plaintext (for users who haven't uploaded
 * a key yet) or refuse to send.
 */
export async function encryptMessage(
  plaintext: string,
  peerPublicKeyB64: string,
): Promise<string> {
  const myPair = await getKeyPair();
  const myPriv = naclUtil.decodeBase64(myPair.secretKey);
  const peerPub = naclUtil.decodeBase64(peerPublicKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipher = nacl.box(naclUtil.decodeUTF8(plaintext), nonce, peerPub, myPriv);
  const envelope: Envelope = {
    v: 1,
    n: naclUtil.encodeBase64(nonce),
    c: naclUtil.encodeBase64(cipher),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypts a JSON envelope using the caller's private key + the peer's
 * public key. Returns the plaintext, or `null` if the payload is malformed,
 * tampered with, or encrypted for someone else.
 *
 * NOTE: returning `null` (rather than throwing) keeps render code simple —
 * we display a placeholder on failure rather than crashing the message list.
 */
export async function decryptMessage(
  envelopeJson: string,
  peerPublicKeyB64: string,
): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    return null;
  }
  if (!isEnvelope(parsed)) return null;

  try {
    const myPair = await getKeyPair();
    const myPriv = naclUtil.decodeBase64(myPair.secretKey);
    const peerPub = naclUtil.decodeBase64(peerPublicKeyB64);
    const nonce = naclUtil.decodeBase64(parsed.n);
    const cipher = naclUtil.decodeBase64(parsed.c);
    const plaintext = nacl.box.open(cipher, nonce, peerPub, myPriv);
    if (!plaintext) return null;
    return naclUtil.encodeUTF8(plaintext);
  } catch {
    return null;
  }
}

/**
 * Best-effort decryption: returns the decrypted plaintext when possible,
 * otherwise treats `payload` as the original plaintext (Phase A
 * backward-compatibility, or messages from peers who haven't uploaded a
 * key yet). Returns a placeholder for envelopes we couldn't decrypt
 * (corrupt / wrong key / new key after re-install).
 */
export async function decryptOrFallback(
  payload: string,
  peerPublicKeyB64: string | null | undefined,
): Promise<string> {
  // Detect the JSON envelope cheaply before paying for a full parse.
  const looksLikeEnvelope = payload.startsWith('{') && payload.includes('"v"');
  if (!looksLikeEnvelope) return payload;
  if (!peerPublicKeyB64) return '🔒 Encrypted message';
  const decrypted = await decryptMessage(payload, peerPublicKeyB64);
  return decrypted ?? '🔒 Cannot decrypt';
}


// ─────────────────────────────────────────────────────────────────────────────
// Media (Phase D) — symmetric encryption for blobs + a structured "media"
// envelope that travels inside the existing E2EE message channel.
//
// Two-layer scheme:
//   1. The MEDIA BYTES are encrypted with a fresh symmetric key per blob
//      (nacl.secretbox: XSalsa20-Poly1305). Ciphertext goes to S3/local.
//   2. The KEY + NONCE + URL travel as a small JSON envelope inside the
//      regular E2EE message payload (nacl.box). Only the recipient's
//      private key can unlock it, so the server never sees the symmetric key.
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaEnvelope {
  kind: 'media';
  blobId: string;
  downloadUrl: string;
  /** Base64 32-byte symmetric key for nacl.secretbox. */
  key: string;
  /** Base64 24-byte nonce. */
  nonce: string;
  mime: string;
  sizeBytes: number;
}

/** Generate a fresh symmetric key + nonce for a single media blob. */
export function makeMediaKey(): { key: Uint8Array; nonce: Uint8Array } {
  return {
    key: nacl.randomBytes(nacl.secretbox.keyLength),     // 32 bytes
    nonce: nacl.randomBytes(nacl.secretbox.nonceLength), // 24 bytes
  };
}

/** Encrypt raw bytes with a per-blob symmetric key. */
export function encryptBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  return nacl.secretbox(plaintext, nonce, key);
}

/** Decrypt blob ciphertext. Returns null on auth failure. */
export function decryptBytes(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Uint8Array | null {
  return nacl.secretbox.open(ciphertext, nonce, key);
}

/**
 * Try to read a decrypted plaintext as a MediaEnvelope. Returns null when
 * the payload is just plain text (the common case). Validates the shape
 * just enough to avoid passing garbage to the download path.
 */
export function parseMediaEnvelope(plaintext: string): MediaEnvelope | null {
  if (!plaintext.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: unknown }).kind !== 'media'
  ) {
    return null;
  }
  const e = parsed as Record<string, unknown>;
  if (
    typeof e.blobId !== 'string' ||
    typeof e.downloadUrl !== 'string' ||
    typeof e.key !== 'string' ||
    typeof e.nonce !== 'string' ||
    typeof e.mime !== 'string' ||
    typeof e.sizeBytes !== 'number'
  ) {
    return null;
  }
  return parsed as MediaEnvelope;
}
