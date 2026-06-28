/**
 * services/media.ts
 * ──────────────────
 * Phase D — encrypted media upload + download. Sits between the chat layer
 * and the raw filesystem / network APIs.
 *
 * Upload path (sender):
 *   1. Read local file as bytes (expo-file-system → base64 → Uint8Array)
 *   2. Generate fresh per-blob symmetric (key, nonce); encrypt bytes
 *   3. Ask backend for an upload URL (POST /media/upload-url)
 *   4. PUT the ciphertext to that URL
 *   5. Return a MediaEnvelope ready to be encrypted+sent over the
 *      existing E2EE message channel
 *
 * Download path (recipient):
 *   1. Receive a decrypted MediaEnvelope inside a normal message body
 *   2. GET the ciphertext blob from envelope.downloadUrl
 *   3. secretbox.open with envelope.key + envelope.nonce
 *   4. Write decrypted bytes to a cached local file; return its file://
 *      URI (for <Image>, <Video>, expo-av, etc.)
 *
 * Decrypted media files live under `${cacheDirectory}/decrypted-media/` and
 * are keyed by blobId so we never re-decrypt the same blob twice in a
 * session. The OS can evict the cache directory at any time, which is
 * fine — we just re-download + re-decrypt.
 */

// expo-file-system v19 (Expo SDK 54) reshaped its API — the imperative
// helpers we use here (cacheDirectory / readAsStringAsync / downloadAsync
// / EncodingType) are exposed under the `/legacy` entry point.
import * as FileSystem from 'expo-file-system/legacy';
import naclUtil from 'tweetnacl-util';

import * as SecureStore from '../utils/secureStorage';
import {
  TOKEN_KEY,
  buildAvatarUrl,
  requestMediaUploadApi,
} from './api';
import {
  decryptBytes,
  encryptBytes,
  makeMediaKey,
  MediaEnvelope,
} from './crypto';

const CACHE_SUBDIR = 'decrypted-media';

// ── Helpers ──────────────────────────────────────────────────────────────────

let cacheDirReady: Promise<string> | null = null;

async function ensureCacheDir(): Promise<string> {
  if (!cacheDirReady) {
    cacheDirReady = (async () => {
      const dir = `${FileSystem.cacheDirectory}${CACHE_SUBDIR}/`;
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
      return dir;
    })();
  }
  return cacheDirReady;
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return naclUtil.decodeBase64(base64);
}

async function writeFileBytes(uri: string, bytes: Uint8Array): Promise<void> {
  await FileSystem.writeAsStringAsync(uri, naclUtil.encodeBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
}

// ── Upload ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  envelope: MediaEnvelope;
}

/**
 * Encrypt the file at `localUri` with a fresh symmetric key, upload the
 * ciphertext to the backend, and return a MediaEnvelope to embed in the
 * outgoing E2EE message.
 *
 * The whole file is buffered in memory — fine for the ~50 MB cap; if we
 * ever raise that, we'll need streaming encryption + chunked uploads.
 */
export async function uploadEncryptedMedia(
  localUri: string,
  mime: string,
): Promise<UploadResult> {
  // 1. Read + encrypt
  const plain = await readFileBytes(localUri);
  const { key, nonce } = makeMediaKey();
  const cipher = encryptBytes(plain, key, nonce);

  // 2. Reserve a blob_id with the backend
  const reservation = await requestMediaUploadApi({
    size_bytes: cipher.length,
    mime,
  });

  // 3. PUT the ciphertext bytes.
  //
  // React Native's fetch() cannot send a raw ArrayBuffer/Uint8Array body as
  // bytes — it drops or stringifies it, so the backend receives the wrong
  // byte count and rejects the upload. Instead we stage the ciphertext in a
  // temp file and stream it with FileSystem.uploadAsync (BINARY_CONTENT),
  // mirroring how downloadAndDecryptMedia uses FileSystem.downloadAsync.
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const dir = await ensureCacheDir();
  const tmpUri = `${dir}${reservation.blob_id}.upload`;
  try {
    await writeFileBytes(tmpUri, cipher);
    const result = await FileSystem.uploadAsync(reservation.upload_url, tmpUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (result.status >= 400) {
      throw new Error(`Media upload failed (${result.status}): ${result.body}`);
    }
  } finally {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }

  return {
    envelope: {
      kind: 'media',
      blobId: reservation.blob_id,
      downloadUrl: reservation.download_url,
      key: naclUtil.encodeBase64(key),
      nonce: naclUtil.encodeBase64(nonce),
      mime,
      sizeBytes: plain.length, // pre-encryption size for progress UI
    },
  };
}

// ── Avatars ──────────────────────────────────────────────────────────────────

// Profile pictures are UNENCRYPTED image blobs (so anyone can view them), but
// the /media endpoint serves bytes as application/octet-stream, which <Image>
// can't reliably decode straight from a URL. So we download to a cached file
// and render that file:// URI instead. Keyed by blobId → a new upload (new
// blob) naturally busts the cache. Deduped so many avatars don't re-download.
const avatarInFlight = new Map<string, Promise<string>>();

export async function downloadAvatar(blobId: string): Promise<string> {
  const inFlight = avatarInFlight.get(blobId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const dir = await ensureCacheDir();
    const target = `${dir}avatar_${blobId}.jpg`;
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists && info.size && info.size > 0) return target;

    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const dl = await FileSystem.downloadAsync(buildAvatarUrl(blobId), target, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (dl.status !== 200) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      throw new Error(`Avatar download failed (${dl.status})`);
    }
    return target;
  })();

  avatarInFlight.set(blobId, promise);
  promise.finally(() => avatarInFlight.delete(blobId));
  return promise;
}

// ── Download ─────────────────────────────────────────────────────────────────

// Per-session in-memory dedupe so multiple bubbles for the same blob (e.g.,
// a forwarded image) only download + decrypt once.
const downloadInFlight = new Map<string, Promise<string>>();

function extensionFor(mime: string): string {
  // Just enough to make players + image viewers happy. Default is .bin so
  // unknown types still download cleanly.
  if (mime.startsWith('image/')) return mime.split('/')[1].replace('jpeg', 'jpg');
  if (mime.startsWith('video/')) return mime.split('/')[1];
  if (mime.startsWith('audio/')) return mime.split('/')[1].replace('mpeg', 'mp3');
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

/**
 * Download the ciphertext blob, decrypt it with the envelope's key+nonce,
 * and write the plaintext to a cached local file. Returns a file:// URI
 * suitable for <Image>, <Video>, or expo-av.
 *
 * The cache key is the blobId, so calling this twice for the same envelope
 * skips re-download. The OS may evict the cache between runs — that's fine,
 * we just rebuild on next call.
 */
export async function downloadAndDecryptMedia(
  envelope: MediaEnvelope,
): Promise<string> {
  const cached = downloadInFlight.get(envelope.blobId);
  if (cached) return cached;

  const promise = (async () => {
    const dir = await ensureCacheDir();
    const ext = extensionFor(envelope.mime);
    const targetUri = `${dir}${envelope.blobId}.${ext}`;

    // Already on disk? Reuse.
    const info = await FileSystem.getInfoAsync(targetUri);
    if (info.exists && info.size && info.size > 0) {
      return targetUri;
    }

    // Download ciphertext to a temp path
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const tmpUri = `${dir}${envelope.blobId}.cipher`;
    const dl = await FileSystem.downloadAsync(envelope.downloadUrl, tmpUri, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (dl.status !== 200) {
      throw new Error(`Media download failed (${dl.status})`);
    }

    // Read cipher → decrypt → write plaintext
    const cipher = await readFileBytes(tmpUri);
    const key = naclUtil.decodeBase64(envelope.key);
    const nonce = naclUtil.decodeBase64(envelope.nonce);
    const plain = decryptBytes(cipher, key, nonce);
    await FileSystem.deleteAsync(tmpUri, { idempotent: true });

    if (!plain) {
      throw new Error('Media decryption failed — wrong key or tampered blob');
    }
    await writeFileBytes(targetUri, plain);
    return targetUri;
  })();

  downloadInFlight.set(envelope.blobId, promise);
  // Always release the slot — successful or not — so retries are possible.
  promise.finally(() => downloadInFlight.delete(envelope.blobId));
  return promise;
}
