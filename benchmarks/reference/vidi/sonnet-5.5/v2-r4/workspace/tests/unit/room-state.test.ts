import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from '../../src/worker/room-state';

const STATES: RoomLifecycle[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
const EVENTS: RoomEvent[] = [
  { type: 'loaded' },
  { type: 'loaded-quarantined' },
  { type: 'load-failed' },
  { type: 'compact-start' },
  { type: 'compact-done' },
  { type: 'compact-rollback' },
  { type: 'append-failed' },
  { type: 'reset' },
  { type: 'hibernate' },
  { type: 'wake' },
  { type: 'connect', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS },
  { type: 'connect', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS - 1 },
];
const key = (e: RoomEvent) => (e.type === 'connect' ? `connect(${e.msSinceLoadFailure})` : e.type);

// Every edge of the lifecycle diagram; anything not listed must leave the state unchanged.
const EDGES: [RoomLifecycle, RoomEvent, RoomLifecycle][] = [
  ['loading', { type: 'loaded' }, 'ready'],
  ['loading', { type: 'loaded-quarantined' }, 'ready'],
  ['loading', { type: 'load-failed' }, 'load-failed'],
  ['ready', { type: 'compact-start' }, 'compacting'],
  ['compacting', { type: 'compact-done' }, 'ready'],
  ['compacting', { type: 'compact-rollback' }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ['storage-failed', { type: 'reset' }, 'loading'],
  ['ready', { type: 'hibernate' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['load-failed', { type: 'connect', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
];

describe('TC-27: nextRoomState', () => {
  it.each(EDGES)('%s --%j--> %s', (from, event, to) => {
    expect(nextRoomState(from, event)).toBe(to);
  });

  it('load-failed stays load-failed when a connection arrives before the retry interval', () => {
    expect(nextRoomState('load-failed', { type: 'connect', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS - 1 })).toBe(
      'load-failed',
    );
  });

  it('every invalid (state, event) pair leaves the state unchanged', () => {
    const valid = new Set(EDGES.map(([s, e]) => `${s}|${key(e)}`));
    for (const s of STATES) {
      for (const e of EVENTS) {
        if (valid.has(`${s}|${key(e)}`)) continue;
        expect(nextRoomState(s, e), `${s} + ${key(e)}`).toBe(s);
      }
    }
  });
});
