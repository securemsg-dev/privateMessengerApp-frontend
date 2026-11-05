/**
 * Voice-message waveform helpers. Pure functions — unit tested.
 *
 * expo-av reports recording loudness as dBFS (−160 … 0). We keep a compact,
 * quantized summary (WAVEFORM_BARS values in 0..WAVEFORM_MAX) inside the
 * E2EE media envelope so the recipient can draw the same bars without
 * decoding the audio.
 */

export const WAVEFORM_BARS = 40;
export const WAVEFORM_MAX = 31;
/** Anything quieter than this is drawn as silence. */
const DB_FLOOR = -60;

/** Map one dBFS reading to 0..1. */
export function levelFromDb(db: number | undefined | null): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  const clamped = Math.min(0, Math.max(DB_FLOOR, db));
  return (clamped - DB_FLOOR) / -DB_FLOOR;
}

/**
 * Downsample raw dBFS readings to `bars` quantized levels. Each bar takes the
 * loudest reading in its time slice (peaks read better than averages), and
 * the result is normalised to the recording's own peak so a quiet speaker
 * still gets a visible shape.
 */
export function buildWaveform(dbSamples: number[], bars = WAVEFORM_BARS): number[] {
  const n = dbSamples.length;
  if (n === 0 || bars <= 0) return [];
  const levels = dbSamples.map(levelFromDb);

  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = Math.floor((i * n) / bars);
    // Fewer samples than bars → each bar repeats its nearest sample.
    const end = Math.max(start + 1, Math.floor(((i + 1) * n) / bars));
    let peak = 0;
    for (let j = start; j < end && j < n; j++) peak = Math.max(peak, levels[j]);
    out.push(peak);
  }

  const max = Math.max(...out);
  const scale = max > 0.05 ? 1 / max : 1;
  return out.map((v) => Math.round(Math.min(1, v * scale) * WAVEFORM_MAX));
}

/**
 * Validate a waveform that arrived inside a (decrypted, but still
 * peer-controlled) envelope. Returns undefined for anything malformed so the
 * UI falls back to placeholder bars instead of rendering garbage.
 */
export function sanitizeWaveform(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return undefined;
  const out: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    out.push(Math.min(WAVEFORM_MAX, Math.max(0, Math.round(v))));
  }
  return out;
}

/** Placeholder bars for messages sent before waveforms existed. */
export function fallbackWaveform(seed: string, bars = WAVEFORM_BARS): number[] {
  const s = seed || 'x';
  return Array.from({ length: bars }, (_, i) => 4 + ((s.charCodeAt(i % s.length) + i * 7) % 22));
}

/** 65_000 → "1:05". Negative/invalid → "0:00". */
export function formatDuration(ms: number | undefined | null): string {
  const total = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Chat-list / notification preview for a voice message. Embeds the duration
 * as "m:ss" so the list row can render "🎤 Voice · 0:12".
 */
export function voicePreviewText(durationMs?: number): string {
  return durationMs && durationMs > 0
    ? `🎤 Voice message (${formatDuration(durationMs)})`
    : '🎤 Voice message';
}
