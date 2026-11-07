/**
 * Group "system" lines ("Alice added Bob and Carol"). The server stores these
 * as plaintext JSON (membership is server-known anyway); this turns one into
 * a sentence. Pure + unit tested.
 */

interface SystemEvent {
  event?: unknown;
  actor_id?: unknown;
  actor_name?: unknown;
  target_ids?: unknown;
  target_names?: unknown;
  name?: unknown;
}

const str = (v: unknown, fallback = 'Someone') =>
  typeof v === 'string' && v.trim() ? v : fallback;

function joinNames(names: string[]): string {
  if (names.length === 0) return 'someone';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** Display text for a system message payload, from `myUserId`'s point of view. */
export function describeSystemEvent(payload: string, myUserId: string | null): string {
  let e: SystemEvent;
  try {
    e = JSON.parse(payload) as SystemEvent;
  } catch {
    return 'Group updated';
  }
  if (!e || typeof e !== 'object') return 'Group updated';

  const actorIsMe = !!myUserId && e.actor_id === myUserId;
  const actor = actorIsMe ? 'You' : str(e.actor_name);
  const ids = Array.isArray(e.target_ids) ? e.target_ids : [];
  const names = Array.isArray(e.target_names) ? e.target_names : [];
  const targets = ids.map((id, i) => (myUserId && id === myUserId ? 'you' : str(names[i], 'someone')));
  // "you" reads better first: "Alice added you and Bob".
  targets.sort((a, b) => (a === 'you' ? -1 : b === 'you' ? 1 : 0));
  const groupName = typeof e.name === 'string' ? e.name : '';

  switch (e.event) {
    case 'group_created':
      return groupName ? `${actor} created the group “${groupName}”` : `${actor} created the group`;
    case 'members_added':
      return `${actor} added ${joinNames(targets)}`;
    case 'member_removed':
      return `${actor} removed ${joinNames(targets)}`;
    case 'member_left':
      return `${actor} left`;
    case 'renamed':
      return groupName ? `${actor} renamed the group to “${groupName}”` : `${actor} renamed the group`;
    default:
      return 'Group updated';
  }
}
