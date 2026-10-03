import { describe, it, expect } from 'vitest';
import {
  nextRoomState,
  type RoomLifecycleState,
  type RoomEvent,
} from '../../src/worker/room-state';

/**
 * TC-27: nextRoomState covers every edge of the design's room lifecycle
 * diagram, and leaves the state unchanged for invalid events.
 */
describe('TC-27: nextRoomState — every edge of the room lifecycle diagram', () => {
  it('Loading → Ready (snapshot and log applied)', () => {
    expect(nextRoomState('loading', 'load-success')).toBe('ready');
  });

  it('Loading → Ready (log rows quarantined, rest applied)', () => {
    // Same target state as a clean load; quarantining is a detail of the load.
    expect(nextRoomState('loading', 'load-success')).toBe('ready');
  });

  it('Loading → LoadFailed (snapshot unreadable or SQL error)', () => {
    expect(nextRoomState('loading', 'load-failed')).toBe('load-failed');
  });

  it('Ready → Ready (update applied, stored, broadcast)', () => {
    expect(nextRoomState('ready', 'update-applied')).toBe('ready');
  });

  it('Ready → Compacting (log exceeds threshold)', () => {
    expect(nextRoomState('ready', 'compact-start')).toBe('compacting');
  });

  it('Compacting → Ready (snapshot replaced, log truncated)', () => {
    expect(nextRoomState('compacting', 'compact-done')).toBe('ready');
  });

  it('Compacting → Ready (compaction error rolled back, log intact)', () => {
    // Both success and rollback land back in Ready.
    expect(nextRoomState('compacting', 'compact-done')).toBe('ready');
  });

  it('Ready → StorageFailed (insert throws)', () => {
    expect(nextRoomState('ready', 'storage-error')).toBe('storage-failed');
  });

  it('StorageFailed → Loading (sockets closed, doc discarded, next connection)', () => {
    expect(nextRoomState('storage-failed', 'reconnect')).toBe('loading');
  });

  it('Ready → Hibernated (no events, sockets may stay open)', () => {
    expect(nextRoomState('ready', 'hibernate')).toBe('hibernated');
  });

  it('Hibernated → Loading (message or new connection wakes object)', () => {
    expect(nextRoomState('hibernated', 'wake')).toBe('loading');
  });

  it('LoadFailed → Loading (new connection after LOAD_RETRY_MIN_INTERVAL_MS)', () => {
    expect(nextRoomState('load-failed', 'retry-load')).toBe('loading');
  });

  it('LoadFailed → LoadFailed (connection before interval, closed 4500)', () => {
    expect(nextRoomState('load-failed', 'retry-blocked')).toBe('load-failed');
  });
});

describe('TC-27 (negative): invalid events leave the state unchanged', () => {
  const states: RoomLifecycleState[] = [
    'loading',
    'ready',
    'compacting',
    'storage-failed',
    'hibernated',
    'load-failed',
  ];
  const events: RoomEvent[] = [
    'load-success',
    'load-failed',
    'update-applied',
    'compact-start',
    'compact-done',
    'storage-error',
    'reconnect',
    'hibernate',
    'wake',
    'retry-load',
    'retry-blocked',
  ];

  // The set of valid (state, event) → target transitions.
  const valid: Record<string, RoomLifecycleState> = {
    'loading|load-success': 'ready',
    'loading|load-failed': 'load-failed',
    'ready|update-applied': 'ready',
    'ready|compact-start': 'compacting',
    'ready|storage-error': 'storage-failed',
    'ready|hibernate': 'hibernated',
    'compacting|compact-done': 'ready',
    'storage-failed|reconnect': 'loading',
    'hibernated|wake': 'loading',
    'load-failed|retry-load': 'loading',
    'load-failed|retry-blocked': 'load-failed',
  };

  it('every invalid (state, event) pair is unchanged', () => {
    for (const state of states) {
      for (const event of events) {
        const key = `${state}|${event}`;
        if (key in valid) continue;
        expect(nextRoomState(state, event), `invalid event ${event} on ${state}`).toBe(state);
      }
    }
  });
});
