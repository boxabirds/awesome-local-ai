import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState } from '@/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '@/shared/protocol';

const conn = (now: number, last: number, interval?: number) => ({
  type: 'connection' as const,
  now,
  lastLoadAttempt: last,
  ...(interval ? { retryIntervalMs: interval } : {}),
});

describe('persist.room state machine (unit, TC-27)', () => {
  it('Loading -> Ready on load-succeeded (quarantined form included)', () => {
    expect(nextRoomState('loading', { type: 'load-succeeded' }).state).toBe('ready');
    expect(nextRoomState('loading', { type: 'load-succeeded', quarantined: 3 }).state).toBe('ready');
  });

  it('Loading -> LoadFailed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' }).state).toBe('load-failed');
  });

  it('Ready -> Ready on append-ok (stays ready)', () => {
    expect(nextRoomState('ready', { type: 'append-ok' }).state).toBe('ready');
  });

  it('Ready -> StorageFailed on append-failed', () => {
    expect(nextRoomState('ready', { type: 'append-failed' }).state).toBe('storage-failed');
  });

  it('Ready -> Compacting on compaction-start; Compacting -> Ready on success and rollback', () => {
    expect(nextRoomState('ready', { type: 'compaction-start' }).state).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'compaction-success' }).state).toBe('ready');
    expect(nextRoomState('compacting', { type: 'compaction-rollback' }).state).toBe('ready');
  });

  it('StorageFailed -> Loading on next-connection', () => {
    expect(nextRoomState('storage-failed', { type: 'next-connection' }).state).toBe('loading');
  });

  it('Ready -> Hibernated on hibernate; Hibernated -> Loading on wake', () => {
    expect(nextRoomState('ready', { type: 'hibernate' }).state).toBe('hibernated');
    expect(nextRoomState('hibernated', { type: 'wake' }).state).toBe('loading');
  });

  it('LoadFailed -> Loading only after the retry interval (boundary)', () => {
    const last = 1000;
    // Before the interval: stays LoadFailed and closes the connection 4500.
    const tooSoon = nextRoomState('load-failed', conn(last + LOAD_RETRY_MIN_INTERVAL_MS - 1, last));
    expect(tooSoon.state).toBe('load-failed');
    expect(tooSoon.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    // Exactly at the interval: retries (Loading, no close).
    const atBoundary = nextRoomState('load-failed', conn(last + LOAD_RETRY_MIN_INTERVAL_MS, last));
    expect(atBoundary.state).toBe('loading');
    expect(atBoundary.closeCode).toBeNull();
    // After the interval: retries.
    const after = nextRoomState('load-failed', conn(last + LOAD_RETRY_MIN_INTERVAL_MS + 50, last));
    expect(after.state).toBe('loading');
  });

  it('honours a custom retry interval', () => {
    const last = 0;
    expect(nextRoomState('load-failed', conn(999, last, 1000)).state).toBe('load-failed');
    expect(nextRoomState('load-failed', conn(1000, last, 1000)).state).toBe('loading');
  });

  it('invalid events for a state leave it unchanged and close nothing (negative)', () => {
    const cases: Array<[RoomState, Parameters<typeof nextRoomState>[1]]> = [
      // loading only accepts load-* events
      ['loading', { type: 'append-ok' }],
      ['loading', { type: 'append-failed' }],
      ['loading', { type: 'compaction-start' }],
      ['loading', { type: 'hibernate' }],
      // ready has no load/hibernate-exit edges
      ['ready', { type: 'load-succeeded' }],
      ['ready', { type: 'load-failed' }],
      ['ready', { type: 'wake' }],
      // compacting only accepts compaction-*
      ['compacting', { type: 'append-ok' }],
      ['compacting', { type: 'append-failed' }],
      ['compacting', { type: 'hibernate' }],
      // storage-failed only accepts next-connection
      ['storage-failed', { type: 'wake' }],
      ['storage-failed', { type: 'load-failed' }],
      // hibernated only accepts wake
      ['hibernated', { type: 'next-connection' }],
      ['hibernated', { type: 'load-succeeded' }],
      // load-failed only accepts connection
      ['load-failed', { type: 'wake' }],
      ['load-failed', { type: 'append-ok' }],
    ];
    for (const [state, event] of cases) {
      const out = nextRoomState(state, event);
      expect(out.state, `${state} + ${event.type}`).toBe(state);
      expect(out.closeCode, `${state} + ${event.type}`).toBeNull();
    }
  });

  it('close codes are only ever attached to load-failed refusals', () => {
    // No transition other than the load-failed refusal carries a close code.
    const all = [
      nextRoomState('loading', { type: 'load-succeeded' }),
      nextRoomState('loading', { type: 'load-failed' }),
      nextRoomState('ready', { type: 'append-ok' }),
      nextRoomState('ready', { type: 'append-failed' }),
      nextRoomState('ready', { type: 'compaction-start' }),
      nextRoomState('ready', { type: 'hibernate' }),
      nextRoomState('compacting', { type: 'compaction-success' }),
      nextRoomState('compacting', { type: 'compaction-rollback' }),
      nextRoomState('storage-failed', { type: 'next-connection' }),
      nextRoomState('hibernated', { type: 'wake' }),
      // load-failed with the interval elapsed -> Loading (no close).
      nextRoomState('load-failed', conn(LOAD_RETRY_MIN_INTERVAL_MS, 0)),
    ];
    for (const t of all) expect(t.closeCode).toBeNull();
    // And the constant is what the refusal uses.
    expect(CLOSE_BOARD_LOAD_FAILED).toBe(4500);
    expect(CLOSE_STORAGE_FAILURE).toBe(1011);
  });
});
