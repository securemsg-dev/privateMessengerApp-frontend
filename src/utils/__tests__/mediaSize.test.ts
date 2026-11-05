import { bubbleSize, fitWithin } from '../mediaSize';

describe('fitWithin', () => {
  it('scales the long edge down to the limit, keeping the ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('keeps tiny dimensions ≥ 1px', () => {
    expect(fitWithin(10000, 3, 100)).toEqual({ width: 100, height: 1 });
  });

  it('passes through unknown/invalid sizes', () => {
    expect(fitWithin(0, 0, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('bubbleSize', () => {
  it('uses the real aspect ratio', () => {
    expect(bubbleSize(1600, 1200, 200)).toEqual({ width: 200, height: 150 });
    expect(bubbleSize(1080, 1350, 200)).toEqual({ width: 200, height: 250 });
  });

  it('clamps extreme ratios', () => {
    expect(bubbleSize(4000, 500, 200).height).toBe(100); // panorama → 0.5
    expect(bubbleSize(500, 4000, 200).height).toBe(270); // tall screenshot → 1.35
  });

  it('falls back to 4:3 when unknown', () => {
    expect(bubbleSize(undefined, undefined, 200)).toEqual({ width: 200, height: 150 });
  });
});
