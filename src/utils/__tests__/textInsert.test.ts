import { insertAtSelection } from '../textInsert';

describe('insertAtSelection', () => {
  it('appends when no selection is known', () => {
    expect(insertAtSelection('hi', null, '😀')).toEqual({ text: 'hi😀', cursor: 4 });
  });

  it('inserts at the cursor', () => {
    expect(insertAtSelection('hello', { start: 2, end: 2 }, '👍')).toEqual({
      text: 'he👍llo',
      cursor: 4,
    });
  });

  it('replaces a selected range', () => {
    expect(insertAtSelection('hello world', { start: 6, end: 11 }, '🌍')).toEqual({
      text: 'hello 🌍',
      cursor: 8,
    });
  });

  it('clamps a stale selection past the end of the text', () => {
    expect(insertAtSelection('ab', { start: 10, end: 12 }, '❤️')).toEqual({
      text: 'ab❤️',
      cursor: 4,
    });
  });

  it('normalises a reversed selection', () => {
    expect(insertAtSelection('abcd', { start: 3, end: 1 }, 'X')).toEqual({
      text: 'aXd',
      cursor: 2,
    });
  });

  it('refuses an insert that would exceed maxLength', () => {
    expect(insertAtSelection('abc', { start: 3, end: 3 }, '😀', 4)).toEqual({
      text: 'abc',
      cursor: 3,
    });
  });
});
