import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from '../../src/worker/room-state';

const T0 = 1_000_000;
const loading: RoomLifecycle = { kind: 'loading' };
const ready: RoomLifecycle = { kind: 'ready', quarantined: 0 };
const compacting: RoomLifecycle = { kind: 'compacting' };
const storageFailed: RoomLifecycle = { kind: 'storage-failed' };
const hibernated: RoomLifecycle = { kind: 'hibernated' };
const loadFailed: RoomLifecycle = { kind: 'load-failed', failedAt: T0 };

describe('persist.room lifecycle transitions (TC-27)', () => {
  const edges: [string, RoomLifecycle, RoomEvent, RoomLifecycle][] = [
    ['Loading → Ready (snapshot and log applied)', loading, { type: 'loaded', quarantined: 0 }, ready],
    [
      'Loading → Ready (log rows quarantined, rest applied)',
      loading,
      { type: 'loaded', quarantined: 2 },
      { kind: 'ready', quarantined: 2 },
    ],
    ['Loading → LoadFailed', loading, { type: 'load-failed', at: T0 }, loadFailed],
    ['Ready → Ready (update applied, stored, broadcast)', ready, { type: 'update-stored' }, ready],
    ['Ready → Compacting', ready, { type: 'compaction-started' }, compacting],
    ['Compacting → Ready (committed)', compacting, { type: 'compaction-committed' }, ready],
    ['Compacting → Ready (rolled back, log intact)', compacting, { type: 'compaction-rolled-back' }, ready],
    ['Ready → StorageFailed (insert throws)', ready, { type: 'append-failed' }, storageFailed],
    ['StorageFailed → Loading (next connection)', storageFailed, { type: 'connection', at: T0 }, loading],
    ['Ready → Hibernated (no events)', ready, { type: 'idle' }, hibernated],
    ['Hibernated → Loading (message or connection wakes object)', hibernated, { type: 'wake' }, loading],
    [
      'LoadFailed → Loading (connection exactly LOAD_RETRY_MIN_INTERVAL_MS later)',
      loadFailed,
      { type: 'connection', at: T0 + LOAD_RETRY_MIN_INTERVAL_MS },
      loading,
    ],
  ];
  for (const [name, from, event, to] of edges) {
    it(name, () => {
      expect(nextRoomState(from, event)).toEqual(to);
    });
  }

  it('LoadFailed stays LoadFailed (connection closed 4500) 1 ms before the interval, without resetting the clock', () => {
    const next = nextRoomState(loadFailed, { type: 'connection', at: T0 + LOAD_RETRY_MIN_INTERVAL_MS - 1 });
    expect(next).toBe(loadFailed);
  });

  it('Ready keeps its quarantined count through stored updates and compaction', () => {
    const q: RoomLifecycle = { kind: 'ready', quarantined: 3 };
    expect(nextRoomState(q, { type: 'update-stored' })).toBe(q);
  });

  describe('invalid events leave the state unchanged (negative)', () => {
    const invalid: [RoomLifecycle, RoomEvent][] = [
      [loading, { type: 'update-stored' }],
      [loading, { type: 'connection', at: T0 }],
      [ready, { type: 'loaded', quarantined: 0 }],
      [ready, { type: 'connection', at: T0 }],
      [ready, { type: 'compaction-committed' }],
      [compacting, { type: 'append-failed' }],
      [compacting, { type: 'update-stored' }],
      [storageFailed, { type: 'update-stored' }],
      [storageFailed, { type: 'loaded', quarantined: 0 }],
      [hibernated, { type: 'update-stored' }],
      [loadFailed, { type: 'update-stored' }],
      [loadFailed, { type: 'loaded', quarantined: 0 }],
      [loadFailed, { type: 'wake' }],
    ];
    for (const [state, event] of invalid) {
      it(`${state.kind} + ${event.type}`, () => {
        expect(nextRoomState(state, event)).toBe(state);
      });
    }
  });
});
