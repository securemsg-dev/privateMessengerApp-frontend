import { formatPresence } from '../presence';

const now = new Date(2026, 10, 5, 15, 0, 0); // 5 Nov 2026 15:00 local
const at = (d: Date) => d.toISOString();
const p = (online: boolean, lastSeen: string | null) => ({ userId: 'u', online, lastSeen });

describe('formatPresence', () => {
  it('shows nothing without data or for hidden peers', () => {
    expect(formatPresence(null, now)).toBe('');
    expect(formatPresence(p(false, null), now)).toBe('');
    expect(formatPresence(p(false, 'garbage'), now)).toBe('');
  });

  it('shows Online', () => {
    expect(formatPresence(p(true, null), now)).toBe('Online');
    expect(formatPresence(p(true, at(new Date(2026, 0, 1))), now)).toBe('Online');
  });

  it('formats recent last-seen times', () => {
    expect(formatPresence(p(false, at(new Date(2026, 10, 5, 14, 59, 40))), now)).toBe('Last seen just now');
    expect(formatPresence(p(false, at(new Date(2026, 10, 5, 14, 55))), now)).toBe('Last seen 5 min ago');
    expect(formatPresence(p(false, at(new Date(2026, 10, 5, 9, 7))), now)).toBe('Last seen today at 09:07');
  });

  it('formats older last-seen times', () => {
    expect(formatPresence(p(false, at(new Date(2026, 10, 4, 22, 30))), now)).toBe(
      'Last seen yesterday at 22:30',
    );
    expect(formatPresence(p(false, at(new Date(2026, 9, 28, 8, 0))), now)).toBe('Last seen Oct 28');
    expect(formatPresence(p(false, at(new Date(2025, 11, 31, 8, 0))), now)).toBe('Last seen Dec 31, 2025');
  });
});
