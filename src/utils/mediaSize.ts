/**
 * Size helpers for media. Pure + unit tested.
 */

/** Scale (w×h) down so the longer side is ≤ maxSide (never scales up). */
export function fitWithin(w: number, h: number, maxSide: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: w, height: h };
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: Math.round(w), height: Math.round(h) };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Bubble box for an image/video of (w×h): fixed width, height from the real
 * aspect ratio, clamped so panoramas and very tall screenshots stay sane.
 * Falls back to 4:3 when dimensions are unknown (older messages).
 */
export function bubbleSize(
  w: number | undefined,
  h: number | undefined,
  width: number,
): { width: number; height: number } {
  const ratio = w && h && w > 0 && h > 0 ? h / w : 0.75;
  const clamped = Math.min(1.35, Math.max(0.5, ratio));
  return { width, height: Math.round(width * clamped) };
}
