import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomPhase } from '../../src/worker/room-state';

describe('TC-27: nextRoomState', () => {
  const edges: [RoomPhase, RoomEvent, RoomPhase][] = [
    ['loading', { type: 'loaded' }, 'ready'],
    ['loading', { type: 'load-error' }, 'load-failed'],
    ['ready', { type: 'compact-start' }, 'compacting'],
    ['compacting', { type: 'compact-done' }, 'ready'],
    ['compacting', { type: 'compact-failed' }, 'ready'],
    ['ready', { type: 'append-failed' }, 'storage-failed'],
    ['storage-failed', { type: 'reset' }, 'loading'],
    ['ready', { type: 'hibernate' }, 'hibernated'],
    ['hibernated', { type: 'wake' }, 'loading'],
    ['load-failed', { type: 'connect', sinceLoadFailedMs: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
    ['load-failed', { type: 'connect', sinceLoadFailedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'load-failed'],
  ];
  for (const [from, event, to] of edges) {
    it(`${from} --${event.type}--> ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('invalid events leave every state unchanged', () => {
    const states: RoomPhase[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
    const events: RoomEvent[] = [
      { type: 'loaded' }, { type: 'load-error' }, { type: 'compact-start' }, { type: 'compact-done' },
      { type: 'compact-failed' }, { type: 'append-failed' }, { type: 'reset' }, { type: 'hibernate' },
      { type: 'wake' }, { type: 'connect', sinceLoadFailedMs: 0 },
    ];
    const valid = new Set(edges.map(([f, e]) => `${f}:${e.type}`));
    for (const s of states) {
      for (const e of events) {
        if (valid.has(`${s}:${e.type}`)) continue;
        expect(nextRoomState(s, e)).toBe(s);
      }
    }
  });
});
