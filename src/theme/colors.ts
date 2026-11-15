/**
 * Cricchat palette: warm neutrals with a single indigo accent, in a light and
 * a dark variant.
 *
 *  • `primary` is for FILLS that carry white text (sent bubbles, main
 *    buttons, badges) — white on it is ≥ 4.5:1 in both themes.
 *  • `accent` is the same hue tuned for TEXT and small icons drawn on the
 *    background — ≥ 4.5:1 against `background` and `surface`.
 *    (In light mode one indigo does both jobs; in dark mode it can't.)
 */
export const lightColors = {
  primary: '#4055ac',
  accent: '#4055ac',
  background: '#ffffff',
  surface: '#faf8f5',
  text: '#15140f',
  textSecondary: '#6f695e',
  border: '#e8e3da',
  error: '#c0392b',
  danger: '#b3261e',
};

export const darkColors = {
  primary: '#536ccc',
  accent: '#93a5f2',
  background: '#121110',
  surface: '#1c1a18',
  text: '#f3efe9',
  textSecondary: '#a8a195',
  border: '#322f2a',
  error: '#ff8a80',
  danger: '#ff8a80',
};

export type ThemeColors = typeof lightColors;
