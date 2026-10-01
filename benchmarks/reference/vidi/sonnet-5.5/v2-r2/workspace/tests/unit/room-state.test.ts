import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from '../../src/worker/room-state';

const edges: [RoomLifecycle, RoomEvent, RoomLifecycle][] = [
  ['loading', { type: 'load-ok' }, 'ready'],
  ['loading', { type: 'load-ok', quarantined: 2 }, 'ready'],
  ['loading', { type: 'load-failed' }, 'load-failed'],
  ['ready', { type: 'compact-start' }, 'compacting'],
  ['compacting', { type: 'compact-done' }, 'ready'],
  ['compacting', { type: 'compact-rollback' }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ['storage-failed', { type: 'reset-complete' }, 'loading'],
  ['ready', { type: 'idle' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['load-failed', { type: 'connect', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
  ['load-failed', { type: 'connect', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 }, 'loading'],
  ['load-failed', { type: 'connect', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'load-failed'],
  ['load-failed', { type: 'connect', sinceFailureMs: 0 }, 'load-failed'],
];

const allEvents: RoomEvent[] = [
  { type: 'load-ok' }, { type: 'load-failed' }, { type: 'compact-start' }, { type: 'compact-done' },
  { type: 'compact-rollback' }, { type: 'append-failed' }, { type: 'reset-complete' }, { type: 'idle' },
  { type: 'wake' }, { type: 'connect', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS * 10 },
];
const allStates: RoomLifecycle[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];

describe('nextRoomState (TC-27)', () => {
  for (const [from, event, to] of edges) {
    it(`${from} --${event.type}${'sinceFailureMs' in event ? `(${event.sinceFailureMs})` : ''}--> ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('every event not listed as an edge leaves the state unchanged', () => {
    for (const state of allStates) {
      for (const event of allEvents) {
        const isEdge = edges.some(([f, e]) => f === state && e.type === event.type);
        if (!isEdge) expect(nextRoomState(state, event), `${state} + ${event.type}`).toBe(state);
      }
    }
  });
});
