import { describe, expect, it } from 'vitest';
import { INITIAL_ROOM_STATE, nextRoomState, type RoomEvent, type RoomLifecycle } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';

const T0 = 1_000_000;
const loading: RoomLifecycle = { kind: 'loading' };
const ready: RoomLifecycle = { kind: 'ready' };
const compacting: RoomLifecycle = { kind: 'compacting' };
const storageFailed: RoomLifecycle = { kind: 'storage-failed' };
const hibernated: RoomLifecycle = { kind: 'hibernated' };
const loadFailed: RoomLifecycle = { kind: 'load-failed', failedAt: T0 };

const ALL_EVENTS: RoomEvent[] = [
  { type: 'loaded', quarantined: 0 },
  { type: 'load-error', at: T0 },
  { type: 'compact-start' },
  { type: 'compact-committed' },
  { type: 'compact-rolled-back' },
  { type: 'append-failed' },
  { type: 'idle' },
  { type: 'wake' },
  { type: 'connect', at: T0 },
];

describe('nextRoomState (persist.room) TC-27', () => {
  it('starts in Loading', () => {
    expect(INITIAL_ROOM_STATE).toEqual(loading);
  });

  it('Loading → Ready when snapshot and log applied', () => {
    expect(nextRoomState(loading, { type: 'loaded', quarantined: 0 })).toEqual({ state: ready });
  });

  it('Loading → Ready when log rows were quarantined', () => {
    expect(nextRoomState(loading, { type: 'loaded', quarantined: 2 })).toEqual({ state: ready });
  });

  it('Loading → LoadFailed records the failure time', () => {
    expect(nextRoomState(loading, { type: 'load-error', at: T0 })).toEqual({ state: loadFailed });
  });

  it('Ready → Compacting → Ready on commit', () => {
    const { state } = nextRoomState(ready, { type: 'compact-start' });
    expect(state).toEqual(compacting);
    expect(nextRoomState(state, { type: 'compact-committed' })).toEqual({ state: ready });
  });

  it('Compacting → Ready on rollback', () => {
    expect(nextRoomState(compacting, { type: 'compact-rolled-back' })).toEqual({ state: ready });
  });

  it('Ready → StorageFailed → Loading on next connection', () => {
    const { state } = nextRoomState(ready, { type: 'append-failed' });
    expect(state).toEqual(storageFailed);
    expect(nextRoomState(state, { type: 'connect', at: T0 })).toEqual({ state: loading });
  });

  it('Ready → Hibernated → Loading on wake', () => {
    const { state } = nextRoomState(ready, { type: 'idle' });
    expect(state).toEqual(hibernated);
    expect(nextRoomState(state, { type: 'wake' })).toEqual({ state: loading });
    expect(nextRoomState(state, { type: 'connect', at: T0 })).toEqual({ state: loading });
  });

  it('LoadFailed stays LoadFailed and closes 4500 before the retry interval', () => {
    const t = nextRoomState(loadFailed, { type: 'connect', at: T0 + LOAD_RETRY_MIN_INTERVAL_MS - 1 });
    expect(t.state).toBe(loadFailed);
    expect(t.close).toBe(CLOSE_BOARD_LOAD_FAILED);
  });

  it('LoadFailed → Loading at exactly the retry interval', () => {
    expect(nextRoomState(loadFailed, { type: 'connect', at: T0 + LOAD_RETRY_MIN_INTERVAL_MS })).toEqual({ state: loading });
  });

  describe('invalid events leave the state unchanged', () => {
    const valid: Record<RoomLifecycle['kind'], RoomEvent['type'][]> = {
      loading: ['loaded', 'load-error'],
      ready: ['compact-start', 'append-failed', 'idle'],
      compacting: ['compact-committed', 'compact-rolled-back'],
      'storage-failed': ['connect'],
      hibernated: ['wake', 'connect'],
      'load-failed': ['connect'],
    };
    for (const state of [loading, ready, compacting, storageFailed, hibernated, loadFailed]) {
      for (const event of ALL_EVENTS.filter((e) => !valid[state.kind].includes(e.type))) {
        it(`${state.kind} ignores ${event.type}`, () => {
          const t = nextRoomState(state, event);
          expect(t.state).toBe(state);
          expect(t.close).toBeUndefined();
        });
      }
    }
  });
});
