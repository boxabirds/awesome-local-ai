// TC-27: the room lifecycle state machine — every edge of the diagram and
// every invalid event (invalid events leave the state unchanged).
import { describe, expect, it } from 'vitest';
import { nextRoomState, type RoomEvent, type RoomState } from '../../src/worker/room-state';

const STATES: RoomState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];

const EVENTS: ReadonlyArray<readonly [string, RoomEvent]> = [
  ['loaded', { type: 'loaded', quarantined: 0 }],
  ['loaded-quarantined', { type: 'loaded', quarantined: 3 }],
  ['load-failed-snapshot', { type: 'load-failed', reason: 'snapshot-unreadable' }],
  ['load-failed-sql', { type: 'load-failed', reason: 'sql-error' }],
  ['update-stored', { type: 'update-stored' }],
  ['compact', { type: 'compact' }],
  ['compact-done-ok', { type: 'compact-done', rolledBack: false }],
  ['compact-done-rollback', { type: 'compact-done', rolledBack: true }],
  ['storage-error', { type: 'storage-error' }],
  ['hibernate', { type: 'hibernate' }],
  ['wake', { type: 'wake' }],
  ['connection-elapsed', { type: 'connection', retryIntervalElapsed: true }],
  ['connection-not-elapsed', { type: 'connection', retryIntervalElapsed: false }],
];

/** The valid edges of the lifecycle diagram; any pair not listed is invalid. */
const VALID_EDGES: Record<string, RoomState> = {
  'loading|loaded': 'ready',
  'loading|loaded-quarantined': 'ready',
  'loading|load-failed-snapshot': 'load-failed',
  'loading|load-failed-sql': 'load-failed',
  'ready|update-stored': 'ready',
  'ready|compact': 'compacting',
  'compacting|compact-done-ok': 'ready',
  'compacting|compact-done-rollback': 'ready',
  'ready|storage-error': 'storage-failed',
  'ready|hibernate': 'hibernated',
  'hibernated|wake': 'loading',
  'storage-failed|connection-elapsed': 'loading',
  'storage-failed|connection-not-elapsed': 'loading',
  'load-failed|connection-elapsed': 'loading',
  'load-failed|connection-not-elapsed': 'load-failed',
};

describe('TC-27 room state machine', () => {
  it.each(
    STATES.flatMap((state) =>
      EVENTS.map(([key, event]) => [state, key, event] as const),
    ),
  )('state "%s" + event "%s" -> "%s"', (state, key, event) => {
    const expected = VALID_EDGES[`${state}|${key}`] ?? state;
    expect(nextRoomState(state, event)).toBe(expected);
  });
});
