import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { type RoomEvent, type RoomState, nextRoomState } from '../../src/worker/room-state';

const T = 1_000_000;
const loading: RoomState = { name: 'loading' };
const ready: RoomState = { name: 'ready' };
const compacting: RoomState = { name: 'compacting' };
const storageFailed: RoomState = { name: 'storage-failed' };
const hibernated: RoomState = { name: 'hibernated' };
const loadFailed: RoomState = { name: 'load-failed', failedAt: T };

const ALL_EVENTS: RoomEvent[] = [
  { type: 'loaded', quarantined: 0 },
  { type: 'loaded', quarantined: 1 },
  { type: 'load-failed', at: T },
  { type: 'compaction-started' },
  { type: 'compaction-finished', ok: true },
  { type: 'compaction-finished', ok: false },
  { type: 'append-failed' },
  { type: 'connection', at: T },
  { type: 'connection', at: T + LOAD_RETRY_MIN_INTERVAL_MS },
  { type: 'idle' },
  { type: 'wake' },
];

describe('persist.room nextRoomState (TC-27)', () => {
  const edges: [string, RoomState, RoomEvent, RoomState][] = [
    ['Loading → Ready', loading, { type: 'loaded', quarantined: 0 }, ready],
    ['Loading → Ready (log rows quarantined)', loading, { type: 'loaded', quarantined: 2 }, ready],
    ['Loading → LoadFailed', loading, { type: 'load-failed', at: T }, loadFailed],
    ['Ready → Compacting', ready, { type: 'compaction-started' }, compacting],
    ['Compacting → Ready (snapshot replaced)', compacting, { type: 'compaction-finished', ok: true }, ready],
    ['Compacting → Ready (rolled back)', compacting, { type: 'compaction-finished', ok: false }, ready],
    ['Ready → StorageFailed', ready, { type: 'append-failed' }, storageFailed],
    ['StorageFailed → Loading on the next connection', storageFailed, { type: 'connection', at: T }, loading],
    ['Ready → Hibernated', ready, { type: 'idle' }, hibernated],
    ['Hibernated → Loading', hibernated, { type: 'wake' }, loading],
    [
      'LoadFailed → Loading on a connection exactly LOAD_RETRY_MIN_INTERVAL_MS later',
      loadFailed,
      { type: 'connection', at: T + LOAD_RETRY_MIN_INTERVAL_MS },
      loading,
    ],
    [
      'LoadFailed stays LoadFailed on a connection before the interval',
      loadFailed,
      { type: 'connection', at: T + LOAD_RETRY_MIN_INTERVAL_MS - 1 },
      loadFailed,
    ],
  ];

  it.each(edges)('%s', (_label, from, event, to) => {
    expect(nextRoomState(from, event)).toEqual(to);
  });

  // Events a state reacts to (a connection to LoadFailed only after the interval, covered above).
  const valid = new Set(edges.map(([, from, event]) => `${from.name}:${event.type}`));
  const invalid = [loading, ready, compacting, storageFailed, hibernated, loadFailed].flatMap(
    (state) =>
      ALL_EVENTS.filter(
        (event) =>
          !valid.has(`${state.name}:${event.type}`) ||
          (state.name === 'load-failed' &&
            event.type === 'connection' &&
            event.at - state.failedAt < LOAD_RETRY_MIN_INTERVAL_MS),
      ).map((event) => [state.name, event.type, state, event] as const),
  );

  it.each(invalid)('invalid in %s: %s leaves the state unchanged', (_s, _e, state, event) => {
    expect(nextRoomState(state, event)).toBe(state);
  });
});
