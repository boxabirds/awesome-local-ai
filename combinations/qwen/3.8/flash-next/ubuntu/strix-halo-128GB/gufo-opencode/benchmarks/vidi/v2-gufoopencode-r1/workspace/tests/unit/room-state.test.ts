import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomPhase } from '../../src/worker/room-state';

const ok = (quarantined = 0): RoomEvent => ({ type: 'load-succeeded', quarantined });

describe('TC-27 room lifecycle transitions', () => {
  it('Loading → Ready on a clean load and on a load with quarantined rows', () => {
    expect(nextRoomState('loading', ok(0))).toBe('ready');
    expect(nextRoomState('loading', ok(3))).toBe('ready');
  });

  it('Loading → LoadFailed when the load reports failure', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('Ready → Compacting → Ready on compaction success', () => {
    const compacting = nextRoomState('ready', { type: 'begin-compact' });
    expect(compacting).toBe('compacting');
    expect(nextRoomState(compacting, { type: 'compact-succeeded' })).toBe('ready');
  });

  it('Ready → Compacting → Ready on compaction failure (rollback keeps serving)', () => {
    const compacting = nextRoomState('ready', { type: 'begin-compact' });
    expect(nextRoomState(compacting, { type: 'compact-failed' })).toBe('ready');
  });

  it('Ready → StorageFailed, and a later Reload returns to Loading', () => {
    const failed = nextRoomState('ready', { type: 'storage-error' });
    expect(failed).toBe('storage-failed');
    expect(nextRoomState(failed, { type: 'reload' })).toBe('loading');
  });

  it('Ready → Hibernated, and a Wake returns to Loading', () => {
    const hibernated = nextRoomState('ready', { type: 'idle' });
    expect(hibernated).toBe('hibernated');
    expect(nextRoomState(hibernated, { type: 'wake' })).toBe('loading');
  });

  it('LoadFailed retries only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 })).toBe(
      'load-failed'
    );
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })).toBe('loading');
    expect(nextRoomState('load-failed', { type: 'retry-load', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 10_000 })).toBe(
      'loading'
    );
  });

  it('negative: events that do not apply in a phase leave it unchanged', () => {
    const invalid: Array<[RoomPhase, RoomEvent]> = [
      ['loading', { type: 'begin-compact' }],
      ['loading', { type: 'storage-error' }],
      ['loading', { type: 'idle' }],
      ['loading', { type: 'wake' }],
      ['loading', { type: 'reload' }],
      ['loading', { type: 'retry-load', elapsedMs: 1_000_000 }],
      ['ready', { type: 'load-succeeded', quarantined: 0 }],
      ['ready', { type: 'load-failed' }],
      ['ready', { type: 'wake' }],
      ['ready', { type: 'reload' }],
      ['ready', { type: 'retry-load', elapsedMs: 1_000_000 }],
      ['compacting', { type: 'idle' }],
      ['compacting', { type: 'storage-error' }],
      ['compacting', { type: 'load-succeeded', quarantined: 0 }],
      ['hibernated', { type: 'begin-compact' }],
      ['hibernated', { type: 'storage-error' }],
      ['hibernated', { type: 'reload' }],
      ['load-failed', { type: 'load-succeeded', quarantined: 0 }],
      ['load-failed', { type: 'idle' }],
      ['load-failed', { type: 'storage-error' }],
      ['load-failed', { type: 'begin-compact' }],
      ['storage-failed', { type: 'begin-compact' }],
      ['storage-failed', { type: 'idle' }],
      ['storage-failed', { type: 'load-succeeded', quarantined: 0 }],
      ['storage-failed', { type: 'retry-load', elapsedMs: 1_000_000 }]
    ];
    for (const [phase, event] of invalid) {
      expect(nextRoomState(phase, event), `${phase} + ${event.type}`).toBe(phase);
    }
  });
});
