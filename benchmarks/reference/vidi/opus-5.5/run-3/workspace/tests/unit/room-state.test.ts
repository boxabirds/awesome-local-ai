import { describe, expect, it } from 'vitest';
import { nextRoomState, type LifecycleState, type RoomEvent } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

const FAILED_AT = 1_000_000;
const connectAt = (now: number): RoomEvent => ({ type: 'connect', now, failedAt: FAILED_AT });

const ALL_EVENTS: RoomEvent[] = [
  { type: 'loaded', quarantined: 0 },
  { type: 'loaded', quarantined: 2 },
  { type: 'load-failed' },
  { type: 'compaction-started' },
  { type: 'compaction-finished', committed: true },
  { type: 'compaction-finished', committed: false },
  { type: 'append-failed' },
  { type: 'idle' },
  { type: 'wake' },
  connectAt(FAILED_AT),
  connectAt(FAILED_AT + LOAD_RETRY_MIN_INTERVAL_MS),
];

/** Every edge of the design's room lifecycle diagram. */
const EDGES: Array<[LifecycleState, RoomEvent, LifecycleState]> = [
  ['loading', { type: 'loaded', quarantined: 0 }, 'ready'],
  ['loading', { type: 'loaded', quarantined: 2 }, 'ready'],
  ['loading', { type: 'load-failed' }, 'load-failed'],
  ['ready', { type: 'compaction-started' }, 'compacting'],
  ['compacting', { type: 'compaction-finished', committed: true }, 'ready'],
  ['compacting', { type: 'compaction-finished', committed: false }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ['storage-failed', connectAt(FAILED_AT), 'loading'],
  ['ready', { type: 'idle' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['hibernated', connectAt(FAILED_AT), 'loading'],
  ['load-failed', connectAt(FAILED_AT + LOAD_RETRY_MIN_INTERVAL_MS), 'loading'],
  ['load-failed', connectAt(FAILED_AT + LOAD_RETRY_MIN_INTERVAL_MS - 1), 'load-failed'],
];

describe('persist.room: nextRoomState', () => {
  it.each(EDGES)('TC-27 %s --%o--> %s', (from, event, to) => {
    expect(nextRoomState(from, event)).toBe(to);
  });

  it('TC-27 a load-failed room only retries once LOAD_RETRY_MIN_INTERVAL_MS has passed', () => {
    expect(nextRoomState('load-failed', connectAt(FAILED_AT))).toBe('load-failed');
    expect(nextRoomState('load-failed', connectAt(FAILED_AT + LOAD_RETRY_MIN_INTERVAL_MS - 1))).toBe('load-failed');
    expect(nextRoomState('load-failed', connectAt(FAILED_AT + LOAD_RETRY_MIN_INTERVAL_MS))).toBe('loading');
  });

  it('TC-27 events outside the diagram leave the state unchanged', () => {
    const states: LifecycleState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
    for (const state of states) {
      for (const event of ALL_EVENTS) {
        // Storage-failed and hibernated rooms reload on any connection, whatever the time.
        const sameEvent = (e: RoomEvent) =>
          (state === 'storage-failed' || state === 'hibernated') && e.type === 'connect'
            ? event.type === 'connect'
            : JSON.stringify(e) === JSON.stringify(event);
        const edge = EDGES.find(([f, e]) => f === state && sameEvent(e));
        const expected = edge ? edge[2] : state;
        expect(nextRoomState(state, event), `${state} + ${JSON.stringify(event)}`).toBe(expected);
      }
    }
  });
});
