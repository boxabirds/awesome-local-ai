import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

describe('persist.room state transitions (TC-27)', () => {
  // --- Valid edges from the design's room lifecycle diagram ---

  it('Loading -> Ready on load-success', () => {
    expect(nextRoomState('loading', { type: 'load-success', quarantined: 0 })).toBe('ready');
  });

  it('Loading -> Ready on load-success with quarantined rows', () => {
    expect(nextRoomState('loading', { type: 'load-success', quarantined: 3 })).toBe('ready');
  });

  it('Loading -> LoadFailed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('Ready -> Ready on update-stored', () => {
    expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
  });

  it('Ready -> Compacting on compaction-start', () => {
    expect(nextRoomState('ready', { type: 'compaction-start' })).toBe('compacting');
  });

  it('Compacting -> Ready on compaction-success', () => {
    expect(nextRoomState('compacting', { type: 'compaction-success' })).toBe('ready');
  });

  it('Compacting -> Ready on compaction-rollback', () => {
    expect(nextRoomState('compacting', { type: 'compaction-rollback' })).toBe('ready');
  });

  it('Ready -> StorageFailed on storage-error', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
  });

  it('StorageFailed -> Loading on wake (next connection)', () => {
    expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
  });

  it('Ready -> Hibernated on hibernate', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
  });

  it('Hibernated -> Loading on wake', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  it('LoadFailed -> Loading on new-connection after the retry interval', () => {
    expect(
      nextRoomState('load-failed', { type: 'new-connection', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS }),
    ).toBe('loading');
    expect(
      nextRoomState('load-failed', { type: 'new-connection', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1000 }),
    ).toBe('loading');
  });

  it('LoadFailed stays LoadFailed on new-connection before the retry interval', () => {
    expect(
      nextRoomState('load-failed', { type: 'new-connection', elapsedMs: 0 }),
    ).toBe('load-failed');
    expect(
      nextRoomState('load-failed', { type: 'new-connection', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }),
    ).toBe('load-failed');
  });

  // --- Invalid events leave the state unchanged (negative) ---

  const states: RoomState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
  const events: RoomEvent[] = [
    { type: 'load-success', quarantined: 0 },
    { type: 'load-failed' },
    { type: 'update-stored' },
    { type: 'compaction-start' },
    { type: 'compaction-success' },
    { type: 'compaction-rollback' },
    { type: 'storage-error' },
    { type: 'hibernate' },
    { type: 'wake' },
    { type: 'new-connection', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS },
  ];

  // The set of (state, event) pairs that ARE valid transitions.
  const valid: Array<[RoomState, RoomEvent['type']]> = [
    ['loading', 'load-success'],
    ['loading', 'load-failed'],
    ['ready', 'update-stored'],
    ['ready', 'compaction-start'],
    ['ready', 'storage-error'],
    ['ready', 'hibernate'],
    ['compacting', 'compaction-success'],
    ['compacting', 'compaction-rollback'],
    ['storage-failed', 'wake'],
    ['hibernated', 'wake'],
    ['load-failed', 'new-connection'],
  ];

  it('every invalid (state, event) pair leaves the state unchanged', () => {
    for (const state of states) {
      for (const event of events) {
        const isValid = valid.some(([s, t]) => s === state && t === event.type);
        const next = nextRoomState(state, event);
        if (isValid) {
          // For load-failed + new-connection the result depends on elapsedMs; both
          // outcomes are "load-failed" or "loading", so skip the strict unchanged check.
          if (state === 'load-failed' && event.type === 'new-connection') continue;
          expect(next, `state=${state} event=${event.type}`).not.toBe(undefined);
        } else {
          expect(next, `state=${state} event=${event.type} should be unchanged`).toBe(state);
        }
      }
    }
  });
});
