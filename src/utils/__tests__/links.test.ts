import { extractLinks, monthLabel } from '../links';

describe('extractLinks', () => {
  it('finds links, trims sentence punctuation and de-duplicates', () => {
    expect(
      extractLinks('See https://example.com/a?b=1, then (https://example.com/c). Again https://example.com/a?b=1'),
    ).toEqual(['https://example.com/a?b=1', 'https://example.com/c']);
  });

  it('ignores text without links', () => {
    expect(extractLinks('no links here, just www.example.com')).toEqual([]);
  });
});

describe('monthLabel', () => {
  const now = new Date(2026, 10, 15);
  it('labels the current month', () => {
    expect(monthLabel(new Date(2026, 10, 2).toISOString(), now)).toBe('This month');
  });
  it('names other months with the year', () => {
    expect(monthLabel(new Date(2026, 9, 2).toISOString(), now)).toMatch(/2026/);
  });
});
