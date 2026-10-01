import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState } from '../../src/worker/room-state';
import type { RoomEvent, RoomLifecycle } from '../../src/worker/room-state';

const connect = (sinceFailureMs: number): RoomEvent => ({
  type: 'connect',
  sinceFailureMs,
  retryAfterMs: LOAD_RETRY_MIN_INTERVAL_MS,
});

const EDGES: [RoomLifecycle, RoomEvent, RoomLifecycle][] = [
  ['loading', { type: 'loaded' }, 'ready'],
  ['loading', { type: 'loaded', quarantined: 2 }, 'ready'],
  ['loading', { type: 'load-error' }, 'load-failed'],
  ['ready', { type: 'update-stored' }, 'ready'],
  ['ready', { type: 'compact-start' }, 'compacting'],
  ['compacting', { type: 'compact-done' }, 'ready'],
  ['compacting', { type: 'compact-error' }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ['storage-failed', { type: 'sockets-closed' }, 'loading'],
  ['storage-failed', connect(0), 'loading'],
  ['ready', { type: 'hibernate' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['hibernated', connect(0), 'loading'],
  ['load-failed', connect(LOAD_RETRY_MIN_INTERVAL_MS), 'loading'],
  ['load-failed', connect(LOAD_RETRY_MIN_INTERVAL_MS + 1), 'loading'],
];

describe('TC-27 nextRoomState', () => {
  for (const [from, event, to] of EDGES) {
    it(`${from} --${event.type}--> ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('load-failed stays load-failed before LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(nextRoomState('load-failed', connect(LOAD_RETRY_MIN_INTERVAL_MS - 1))).toBe('load-failed');
    expect(nextRoomState('load-failed', connect(0))).toBe('load-failed');
  });

  it('every event that is not an edge leaves the state unchanged', () => {
    const events: RoomEvent[] = [
      { type: 'loaded' },
      { type: 'load-error' },
      { type: 'update-stored' },
      { type: 'compact-start' },
      { type: 'compact-done' },
      { type: 'compact-error' },
      { type: 'append-failed' },
      { type: 'sockets-closed' },
      { type: 'hibernate' },
      { type: 'wake' },
      connect(0),
      connect(LOAD_RETRY_MIN_INTERVAL_MS),
    ];
    const states: RoomLifecycle[] = ['loading', 'ready', 'compacting', 'load-failed', 'storage-failed', 'hibernated'];
    for (const state of states) {
      for (const event of events) {
        const isEdge = EDGES.some(([f, e]) => f === state && e.type === event.type) && !(state === 'load-failed' && event.type === 'connect' && event.sinceFailureMs < LOAD_RETRY_MIN_INTERVAL_MS);
        if (!isEdge) expect(nextRoomState(state, event), `${state} + ${event.type}`).toBe(state);
      }
    }
  });
});
