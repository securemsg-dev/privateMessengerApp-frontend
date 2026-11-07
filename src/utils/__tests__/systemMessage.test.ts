import { describeSystemEvent } from '../systemMessage';

const ev = (o: object) => JSON.stringify(o);

describe('describeSystemEvent', () => {
  it('describes group creation', () => {
    expect(describeSystemEvent(ev({ event: 'group_created', actor_id: 'a', actor_name: 'Alice', name: 'Family' }), 'b'))
      .toBe('Alice created the group “Family”');
    expect(describeSystemEvent(ev({ event: 'group_created', actor_id: 'me', actor_name: 'Me', name: 'X' }), 'me'))
      .toBe('You created the group “X”');
  });

  it('names added members, putting "you" first', () => {
    expect(
      describeSystemEvent(
        ev({ event: 'members_added', actor_id: 'a', actor_name: 'Alice', target_ids: ['b', 'me'], target_names: ['Bob', 'Me'] }),
        'me',
      ),
    ).toBe('Alice added you and Bob');
    expect(
      describeSystemEvent(
        ev({
          event: 'members_added', actor_id: 'a', actor_name: 'Alice',
          target_ids: ['b', 'c', 'd', 'e'], target_names: ['Bob', 'Carol', 'Dan', 'Eve'],
        }),
        'x',
      ),
    ).toBe('Alice added Bob, Carol and 2 others');
  });

  it('describes removals, leaving and renames', () => {
    expect(describeSystemEvent(ev({ event: 'member_removed', actor_id: 'a', actor_name: 'Alice', target_ids: ['b'], target_names: ['Bob'] }), 'z'))
      .toBe('Alice removed Bob');
    expect(describeSystemEvent(ev({ event: 'member_left', actor_id: 'b', actor_name: 'Bob' }), 'z')).toBe('Bob left');
    expect(describeSystemEvent(ev({ event: 'renamed', actor_id: 'a', actor_name: 'Alice', name: 'Trip' }), 'z'))
      .toBe('Alice renamed the group to “Trip”');
  });

  it('degrades gracefully', () => {
    expect(describeSystemEvent('not json', 'me')).toBe('Group updated');
    expect(describeSystemEvent(ev({ event: 'future_thing' }), 'me')).toBe('Group updated');
    expect(describeSystemEvent(ev({ event: 'member_left' }), 'me')).toBe('Someone left');
  });
});
