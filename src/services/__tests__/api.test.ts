/**
 * The chat-list request is how this build tells the server what it
 * understands. Dropping a flag would make the server treat every user of
 * this version as running an old app (e.g. refuse to send them view-once).
 */
import { LIST_CONVERSATIONS_PATH } from '../api';

describe('chat list request', () => {
  it('announces groups and view-once support', () => {
    const query = new URLSearchParams(LIST_CONVERSATIONS_PATH.split('?')[1]);
    expect(query.get('include_groups')).toBe('true');
    expect(query.get('view_once')).toBe('true');
  });
});
