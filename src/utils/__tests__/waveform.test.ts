import {
  WAVEFORM_BARS,
  WAVEFORM_MAX,
  buildWaveform,
  fallbackWaveform,
  formatDuration,
  levelFromDb,
  sanitizeWaveform,
} from '../waveform';

describe('levelFromDb', () => {
  it('maps the dB range onto 0..1 and clamps', () => {
    expect(levelFromDb(0)).toBe(1);
    expect(levelFromDb(-60)).toBe(0);
    expect(levelFromDb(-160)).toBe(0);
    expect(levelFromDb(5)).toBe(1);
    expect(levelFromDb(-30)).toBeCloseTo(0.5);
  });

  it('treats missing readings as silence', () => {
    expect(levelFromDb(undefined)).toBe(0);
    expect(levelFromDb(NaN)).toBe(0);
  });
});

describe('buildWaveform', () => {
  it('returns no bars for no samples', () => {
    expect(buildWaveform([])).toEqual([]);
  });

  it('always returns the requested number of bars, quantized', () => {
    const samples = Array.from({ length: 250 }, (_, i) => -60 + (i % 60));
    const bars = buildWaveform(samples);
    expect(bars).toHaveLength(WAVEFORM_BARS);
    for (const b of bars) {
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(WAVEFORM_MAX);
    }
  });

  it('stretches short recordings to the full bar count', () => {
    const bars = buildWaveform([-10, -50], 4);
    expect(bars).toHaveLength(4);
    expect(bars[0]).toBe(WAVEFORM_MAX); // loudest sample → full height after normalising
    expect(bars[3]).toBeLessThan(bars[0]);
  });

  it('normalises a quiet recording to its own peak', () => {
    const bars = buildWaveform([-55, -50, -45, -50], 4);
    expect(Math.max(...bars)).toBe(WAVEFORM_MAX);
  });

  it('keeps pure silence flat', () => {
    expect(buildWaveform([-160, -160, -160], 3)).toEqual([0, 0, 0]);
  });
});

describe('sanitizeWaveform', () => {
  it('accepts and clamps a valid array', () => {
    expect(sanitizeWaveform([0, 12.4, 40, -3])).toEqual([0, 12, WAVEFORM_MAX, 0]);
  });

  it('rejects malformed input', () => {
    expect(sanitizeWaveform('nope')).toBeUndefined();
    expect(sanitizeWaveform([])).toBeUndefined();
    expect(sanitizeWaveform([1, 'x'])).toBeUndefined();
    expect(sanitizeWaveform(new Array(500).fill(1))).toBeUndefined();
  });
});

describe('fallbackWaveform', () => {
  it('is deterministic per seed', () => {
    expect(fallbackWaveform('abc')).toEqual(fallbackWaveform('abc'));
    expect(fallbackWaveform('abc')).toHaveLength(WAVEFORM_BARS);
  });
});

describe('formatDuration', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(4_600)).toBe('0:05');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('handles missing/invalid values', () => {
    expect(formatDuration(undefined)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
