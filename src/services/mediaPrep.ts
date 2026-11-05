/**
 * Pre-upload media preparation (runs before encryption):
 *
 *  • Images are resized to at most MAX_IMAGE_SIDE on the long edge and
 *    re-encoded as JPEG. A 12 MP phone photo drops from several MB to a few
 *    hundred KB, so it encrypts, uploads and downloads far faster. Re-encoding
 *    also strips EXIF metadata (e.g. GPS location) from what we send.
 *  • Videos get a small poster frame (embedded in the E2EE envelope so the
 *    bubble can show it without downloading the video) and a size cap.
 *
 * All display metadata (w/h/duration/poster) rides inside the encrypted
 * envelope — the server never sees it.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';

import type { MediaMeta } from './crypto';
import { fitWithin } from '../utils/mediaSize';

export const MAX_IMAGE_SIDE = 1600;
const IMAGE_QUALITY = 0.8;

/**
 * Client-side video cap. Encryption happens in JS (tweetnacl) and needs a few
 * full copies of the file in memory; on Android there is no export preset to
 * shrink videos first, so very large files risk running out of memory.
 */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** Poster budget inside the envelope (base64 chars). */
const POSTER_MAX_B64 = 16_000;

export interface PreparedMedia {
  uri: string;
  mime: string;
  meta: MediaMeta;
}

export async function prepareImage(
  uri: string,
  width?: number,
  height?: number,
): Promise<PreparedMedia> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (width && height) {
      const target = fitWithin(width, height, MAX_IMAGE_SIDE);
      if (target.width !== width || target.height !== height) {
        ctx.resize({ width: target.width, height: target.height });
      }
    }
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: IMAGE_QUALITY, format: SaveFormat.JPEG });
    return { uri: out.uri, mime: 'image/jpeg', meta: { w: out.width, h: out.height } };
  } catch (err) {
    // Never block a send on optimisation — fall back to the original file.
    if (__DEV__) console.warn('[media] image prep failed, sending original:', err);
    return {
      uri,
      mime: 'image/jpeg',
      meta: width && height ? { w: width, h: height } : {},
    };
  }
}

export class VideoTooLargeError extends Error {
  constructor(public readonly sizeBytes: number) {
    super('Video too large');
  }
}

async function fileSize(uri: string, hint?: number | null): Promise<number> {
  if (hint && hint > 0) return hint;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}

async function makePoster(uri: string): Promise<{ poster?: string }> {
  try {
    const frame = await VideoThumbnails.getThumbnailAsync(uri, { time: 500, quality: 0.7 });
    // Shrink until it fits the envelope budget.
    for (const [side, q] of [[240, 0.5], [180, 0.4], [120, 0.35]] as const) {
      const ctx = ImageManipulator.manipulate(frame.uri);
      const target = fitWithin(frame.width, frame.height, side);
      ctx.resize({ width: target.width, height: target.height });
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ compress: q, format: SaveFormat.JPEG, base64: true });
      if (out.base64 && out.base64.length <= POSTER_MAX_B64) return { poster: out.base64 };
    }
  } catch (err) {
    if (__DEV__) console.warn('[media] poster generation failed:', err);
  }
  return {};
}

export async function prepareVideo(asset: {
  uri: string;
  mimeType?: string | null;
  width?: number;
  height?: number;
  /** Milliseconds (expo-image-picker). */
  duration?: number | null;
  fileSize?: number | null;
}): Promise<PreparedMedia> {
  const size = await fileSize(asset.uri, asset.fileSize);
  if (size > MAX_VIDEO_BYTES) throw new VideoTooLargeError(size);

  const meta: MediaMeta = {};
  if (asset.width && asset.height) {
    meta.w = asset.width;
    meta.h = asset.height;
  }
  if (asset.duration && asset.duration > 0) meta.durationMs = Math.round(asset.duration);
  Object.assign(meta, await makePoster(asset.uri));

  return { uri: asset.uri, mime: asset.mimeType ?? 'video/mp4', meta };
}
