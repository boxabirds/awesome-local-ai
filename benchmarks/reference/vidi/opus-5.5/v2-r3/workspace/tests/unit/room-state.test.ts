import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from '../../src/worker/room-state';

const ALL_STATES: RoomLifecycle[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
const ALL_EVENTS: RoomEvent[] = [
  { type: 'loaded', quarantined: 0 },
  { type: 'loaded', quarantined: 1 },
  { type: 'load-error' },
  { type: 'update-stored' },
  { type: 'compaction-start' },
  { type: 'compaction-committed' },
  { type: 'compaction-rolled-back' },
  { type: 'append-failed' },
  { type: 'idle' },
  { type: 'wake' },
  { type: 'connection', sinceLoadFailureMs: 0 },
  { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 },
  { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS },
];

/** Every edge of the design's room lifecycle diagram. */
const EDGES: [RoomLifecycle, RoomEvent, RoomLifecycle][] = [
  ['loading', { type: 'loaded', quarantined: 0 }, 'ready'],
  ['loading', { type: 'loaded', quarantined: 1 }, 'ready'],
  ['loading', { type: 'load-error' }, 'load-failed'],
  ['ready', { type: 'update-stored' }, 'ready'],
  ['ready', { type: 'compaction-start' }, 'compacting'],
  ['compacting', { type: 'compaction-committed' }, 'ready'],
  ['compacting', { type: 'compaction-rolled-back' }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ['storage-failed', { type: 'connection', sinceLoadFailureMs: 0 }, 'loading'],
  ['storage-failed', { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'loading'],
  ['storage-failed', { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
  ['ready', { type: 'idle' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['load-failed', { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
  ['load-failed', { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'load-failed'],
  ['load-failed', { type: 'connection', sinceLoadFailureMs: 0 }, 'load-failed'],
];

const label = (e: RoomEvent) =>
  e.type === 'loaded' ? `loaded(${e.quarantined})` : e.type === 'connection' ? `connection(+${e.sinceLoadFailureMs}ms)` : e.type;

describe('nextRoomState (persist.room)', () => {
  for (const [from, event, to] of EDGES) {
    it(`TC-27: ${from} --${label(event)}--> ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('TC-27: a load-failed room retries only once LOAD_RETRY_MIN_INTERVAL_MS has passed', () => {
    expect(nextRoomState('load-failed', { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 })).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', { type: 'connection', sinceLoadFailureMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 })).toBe(
      'loading',
    );
  });

  it('TC-27: every event that is not an edge leaves the state unchanged', () => {
    const isEdge = (s: RoomLifecycle, e: RoomEvent) => EDGES.some(([f, ev]) => f === s && JSON.stringify(ev) === JSON.stringify(e));
    let checked = 0;
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        if (isEdge(state, event)) continue;
        expect(nextRoomState(state, event), `${state} + ${label(event)}`).toBe(state);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
