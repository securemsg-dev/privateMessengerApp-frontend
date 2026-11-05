/**
 * Insert `insert` into `text` at a cursor/selection range, replacing any
 * selected text. Returns the new text plus where the cursor should land
 * (just after the inserted string). Respects `maxLength` by refusing an insert
 * that would overflow rather than truncating mid-emoji (a half surrogate pair
 * renders as a broken glyph).
 */
export interface Selection {
  start: number;
  end: number;
}

export function insertAtSelection(
  text: string,
  selection: Selection | null,
  insert: string,
  maxLength = Infinity,
): { text: string; cursor: number } {
  const len = text.length;
  // No known selection → append (e.g. the input was never focused).
  const rawStart = selection ? selection.start : len;
  const rawEnd = selection ? selection.end : len;
  const start = Math.max(0, Math.min(rawStart, rawEnd, len));
  const end = Math.max(start, Math.min(Math.max(rawStart, rawEnd), len));

  const next = text.slice(0, start) + insert + text.slice(end);
  if (next.length > maxLength) {
    return { text, cursor: end };
  }
  return { text: next, cursor: start + insert.length };
}
