/**
 * Chat-header presence text. Pure + unit tested.
 *
 * The server sends {online, last_seen}; a hidden or blocked peer arrives as
 * online=false with last_seen=null, which renders as nothing at all (we never
 * claim "offline" for someone who chose to hide it).
 */

export interface PeerPresence {
  userId: string;
  online: boolean;
  /** ISO timestamp, or null when unknown/hidden. */
  lastSeen: string | null;
}

const pad = (n: number) => n.toString().padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Returns "" when there's nothing to show. */
export function formatPresence(p: PeerPresence | null | undefined, now: Date = new Date()): string {
  if (!p) return '';
  if (p.online) return 'Online';
  if (!p.lastSeen) return '';
  const seen = new Date(p.lastSeen);
  if (Number.isNaN(seen.getTime())) return '';

  const diffMin = Math.floor((now.getTime() - seen.getTime()) / 60000);
  if (diffMin < 1) return 'Last seen just now';
  if (diffMin < 60) return `Last seen ${diffMin} min ago`;
  if (sameDay(seen, now)) return `Last seen today at ${hhmm(seen)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(seen, yesterday)) return `Last seen yesterday at ${hhmm(seen)}`;
  const date = `${MONTHS[seen.getMonth()]} ${seen.getDate()}`;
  return seen.getFullYear() === now.getFullYear()
    ? `Last seen ${date}`
    : `Last seen ${date}, ${seen.getFullYear()}`;
}
