import { useSelector } from 'react-redux';
import { RootState } from '../store';

/** The user's own name for a contact, or null when they haven't set one. */
export const selectCustomContactName = (s: RootState, privateNumber?: string | null) =>
  (privateNumber && s.chat.contactNames[privateNumber]) || null;

/**
 * Name to show for a contact: the user's own name for them when set,
 * otherwise `fallback` (the contact's display name or formatted number).
 */
export function useContactName(privateNumber: string | null | undefined, fallback: string): string {
  const custom = useSelector((s: RootState) => selectCustomContactName(s, privateNumber));
  return custom || fallback;
}
