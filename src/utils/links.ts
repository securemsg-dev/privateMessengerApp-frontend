/** http(s) links found in a piece of text, in order, without duplicates. */
export function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    // Trailing punctuation belongs to the sentence, not the link.
    const url = raw.replace(/[.,!?;:)\]]+$/, '');
    if (url.length > 10 && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** "November 2026" style heading for a timestamp. */
export function monthLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
    return 'This month';
  }
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}
