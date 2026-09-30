import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { type RoomEvent, type RoomLifecycleState, nextRoomState } from '../../src/worker/room-state';

const STATES: RoomLifecycleState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'load-failed', 'hibernated'];

const EVENTS: RoomEvent[] = [
  { type: 'load-succeeded', quarantined: 0 },
  { type: 'load-succeeded', quarantined: 1 },
  { type: 'load-failed' },
  { type: 'update-stored' },
  { type: 'compaction-started' },
  { type: 'compaction-finished' },
  { type: 'compaction-rolled-back' },
  { type: 'append-failed' },
  { type: 'idle' },
  { type: 'wake' },
  { type: 'connection', msSinceLoadFailure: 0 },
  { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS - 1 },
  { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS },
];

/** A new connection, whatever the time since a load failure. */
function connections(from: RoomLifecycleState, to: RoomLifecycleState): [RoomLifecycleState, RoomEvent, RoomLifecycleState][] {
  return EVENTS.filter((e) => e.type === 'connection').map((e) => [from, e, to]);
}

// Every edge of the design's room lifecycle diagram.
const EDGES: [RoomLifecycleState, RoomEvent, RoomLifecycleState][] = [
  ['loading', { type: 'load-succeeded', quarantined: 0 }, 'ready'],
  ['loading', { type: 'load-succeeded', quarantined: 1 }, 'ready'],
  ['loading', { type: 'load-failed' }, 'load-failed'],
  ['ready', { type: 'update-stored' }, 'ready'],
  ['ready', { type: 'compaction-started' }, 'compacting'],
  ['compacting', { type: 'compaction-finished' }, 'ready'],
  ['compacting', { type: 'compaction-rolled-back' }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ...connections('storage-failed', 'loading'),
  ['ready', { type: 'idle' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ...connections('hibernated', 'loading'),
  ['load-failed', { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
  ['load-failed', { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'load-failed'],
  ['load-failed', { type: 'connection', msSinceLoadFailure: 0 }, 'load-failed'],
];

const key = (s: RoomLifecycleState, e: RoomEvent) => `${s} ${JSON.stringify(e)}`;

describe('nextRoomState (TC-27)', () => {
  it.each(EDGES)('%s --%j--> %s', (state, event, expected) => {
    expect(nextRoomState(state, event)).toBe(expected);
  });

  it('LoadFailed retries only once LOAD_RETRY_MIN_INTERVAL_MS has passed (boundary)', () => {
    expect(nextRoomState('load-failed', { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS - 1 })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS })).toBe(
      'loading',
    );
  });

  // Negative: every (state, event) pair that is not an edge leaves the state unchanged.
  const edgeKeys = new Set(EDGES.map(([s, e]) => key(s, e)));
  const invalid = STATES.flatMap((s) => EVENTS.filter((e) => !edgeKeys.has(key(s, e))).map((e) => [s, e] as const));
  it.each(invalid)('invalid: %s ignores %j', (state, event) => {
    expect(nextRoomState(state, event)).toBe(state);
  });
});
