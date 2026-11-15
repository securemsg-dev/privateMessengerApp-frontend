/**
 * View-once plaintext must never land in the shared decrypted-media cache:
 * it goes to its own folder, which the app wipes at every start (covers a
 * crash or force-quit while the viewer was open).
 */
import naclUtil from 'tweetnacl-util';

import { encryptBytes, makeMediaKey, MediaEnvelope } from '../crypto';
import { downloadAndDecryptMedia, purgeViewOnceMedia } from '../media';

// The raw CommonJS mock object (jest/mocks/expo-file-system.js). media.ts's
// `import * as FileSystem` reads through to it, so spies here take effect.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy');
const fs = FileSystem as { cacheDirectory: string };

function envelopeFor(blobId: string, plain: Uint8Array): { env: MediaEnvelope; cipherB64: string } {
  const { key, nonce } = makeMediaKey();
  const cipher = encryptBytes(plain, key, nonce);
  return {
    env: {
      kind: 'media',
      blobId,
      downloadUrl: `https://example.test/api/v1/media/${blobId}`,
      key: naclUtil.encodeBase64(key),
      nonce: naclUtil.encodeBase64(nonce),
      mime: 'image/jpeg',
      sizeBytes: cipher.length,
    },
    cipherB64: naclUtil.encodeBase64(cipher),
  };
}

describe('view-once media files', () => {
  let written: string[];
  let deleted: string[];

  beforeEach(() => {
    written = [];
    deleted = [];
    jest.spyOn(FileSystem, 'writeAsStringAsync').mockImplementation(async (...args: unknown[]) => {
      const uri = args[0] as string;
      written.push(uri);
    });
    jest.spyOn(FileSystem, 'deleteAsync').mockImplementation(async (...args: unknown[]) => {
      const uri = args[0] as string;
      deleted.push(uri);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('decrypts into the view-once folder, not the shared cache', async () => {
    const { env, cipherB64 } = envelopeFor('blob-vo-1', new Uint8Array([1, 2, 3]));
    jest.spyOn(FileSystem, 'readAsStringAsync').mockResolvedValue(cipherB64);

    const uri = await downloadAndDecryptMedia(env, { viewOnce: true });

    expect(uri).toBe(`${fs.cacheDirectory}view-once/blob-vo-1.jpg`);
    expect(written).toEqual([uri]);
    expect(written.some((p) => p.includes('decrypted-media'))).toBe(false);
  });

  it('regular media still uses the shared cache', async () => {
    const { env, cipherB64 } = envelopeFor('blob-n-1', new Uint8Array([4, 5]));
    jest.spyOn(FileSystem, 'readAsStringAsync').mockResolvedValue(cipherB64);

    const uri = await downloadAndDecryptMedia(env);

    expect(uri).toBe(`${fs.cacheDirectory}decrypted-media/blob-n-1.jpg`);
  });

  it('purge removes the whole view-once folder and nothing else', async () => {
    await purgeViewOnceMedia();
    expect(deleted).toEqual([`${fs.cacheDirectory}view-once/`]);
  });
});
