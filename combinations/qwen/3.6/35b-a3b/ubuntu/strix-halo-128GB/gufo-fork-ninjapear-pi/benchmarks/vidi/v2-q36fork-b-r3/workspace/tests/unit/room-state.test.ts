/**
 * Unit tests for room state transitions (TC-27).
 * Tests every edge of the persist.room state diagram and invalid events.
 */

import { describe, it, expect } from 'vitest';

// --- Pure transition function under test ---
export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'compacting' | 'hibernated';
export type RoomEvent =
  // Loading transitions
  | { type: 'load-ok' }
  | { type: 'load-ok-quarantined'; quarantined: number }
  | { type: 'load-error'; reason: 'snapshot-unreadable' | 'sql-error' }
  // Ready → compaction
  | { type: 'compact-start' }
  | { type: 'compact-done'; success: boolean }
  // Ready → storage failure
  | { type: 'append-fail' }
  // Storage failed → reload
  | { type: 'reload-request' }
  // Ready / Hibernated
  | { type: 'update-applied' }
  | { type: 'no-messages' }
  // LoadFailed retry
  | { type: 'retry-after-interval' }
  | { type: 'connection' };

/** Map valid edges of the room lifecycle state diagram to expected next states; leave unchanged on invalid events. */
let lastLoadFailedTimestamp = -Infinity;

const INTERVAL_MS = 5000;

export function setLoadFailedTime(t: number): void {
  lastLoadFailedTimestamp = t;
}

export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading': {
      if (event.type === 'load-ok') return 'ready';
      if (event.type === 'load-ok-quarantined') return 'ready';
      if (event.type === 'load-error') return 'load-failed';
      // Invalid events leave unchanged
      return state;
    }
    case 'ready': {
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-fail') return 'storage-failed';
      if (event.type === 'no-messages') return 'hibernated';
      // update-applied is a self-transition
      return state;
    }
    case 'compacting': {
      if (event.type === 'compact-done' && event.success) return 'ready';
      if (event.type === 'compact-done' && !event.success) return 'ready';
      // Invalid events leave unchanged
      return state;
    }
    case 'storage-failed': {
      if (event.type === 'reload-request') return 'loading';
      // Invalid events leave unchanged
      return state;
    }
    case 'hibernated': {
      if (event.type === 'no-messages') return 'hibernated';
      if (event.type === 'update-applied') {
        // Message received while hibernating wakes object back to loading
        return 'loading';
      }
      // Invalid events leave unchanged
      return state;
    }
    case 'load-failed': {
      if (event.type === 'connection') {
        // Before interval: stay load-failed
        const now = Date.now();
        if (now - lastLoadFailedTimestamp < INTERVAL_MS) return 'load-failed';
        // After interval: retry → go back to loading
        return 'loading';
      }
      if (event.type === 'retry-after-interval') return 'loading';
      // Invalid events leave unchanged
      return state;
    }
    default: {
      return state;
    }
  }
}

describe('TC-27: nextRoomState — every edge and invalid events', () => {
  // ─── Loading ──────────────────────────────────────────────
  it('loading + load-ok → ready', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('loading + load-ok-quarantined → ready', () => {
    expect(nextRoomState('loading', { type: 'load-ok-quarantined', quarantined: 3 })).toBe('ready');
  });

  it('loading + load-error(snap) → load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-error', reason: 'snapshot-unreadable' })).toBe('load-failed');
  });

  it('loading + load-error(sql) → load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-error', reason: 'sql-error' })).toBe('load-failed');
  });

  it('loading + invalid event stays loading', () => {
    expect(nextRoomState('loading', { type: 'append-fail' })).toBe('loading');
    expect(nextRoomState('loading', { type: 'no-messages' })).toBe('loading');
    expect(nextRoomState('loading', { type: 'compact-start' })).toBe('loading');
  });

  // ─── Ready ────────────────────────────────────────────────
  it('ready + compact-start → compacting', () => {
    expect(nextRoomState('ready', { type: 'compact-start' })).toBe('compacting');
  });

  it('ready + append-fail → storage-failed', () => {
    expect(nextRoomState('ready', { type: 'append-fail' })).toBe('storage-failed');
  });

  it('ready + no-messages → hibernated', () => {
    expect(nextRoomState('ready', { type: 'no-messages' })).toBe('hibernated');
  });

  it('ready + update-applied → ready (self-transition)', () => {
    expect(nextRoomState('ready', { type: 'update-applied' })).toBe('ready');
  });

  it('ready + invalid events stay ready', () => {
    expect(nextRoomState('ready', { type: 'load-error', reason: 'snapshot-unreadable' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'reload-request' })).toBe('ready');
  });

  // ─── Compacting ───────────────────────────────────────────
  it('compacting + compact-done(success) → ready', () => {
    expect(nextRoomState('compacting', { type: 'compact-done', success: true })).toBe('ready');
  });

  it('compacting + compact-done(failure) → ready (rollback)', () => {
    expect(nextRoomState('compacting', { type: 'compact-done', success: false })).toBe('ready');
  });

  it('compacting + invalid event stays compacting', () => {
    expect(nextRoomState('compacting', { type: 'load-ok' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'no-messages' })).toBe('compacting');
  });

  // ─── Storage-failed ───────────────────────────────────────
  it('storage-failed + reload-request → loading', () => {
    expect(nextRoomState('storage-failed', { type: 'reload-request' })).toBe('loading');
  });

  it('storage-failed + invalid event stays storage-failed', () => {
    expect(nextRoomState('storage-failed', { type: 'no-messages' })).toBe('storage-failed');
    expect(nextRoomState('storage-failed', { type: 'load-ok' })).toBe('storage-failed');
  });



  it('hibernated + update-applied → loading (wakes on message)', () => {
    // Per state diagram: Hibernated → Loading when woken by a message
    expect(nextRoomState('hibernated', { type: 'update-applied' })).toBe('loading');
  });

  it('hibernated + no-messages → hibernated (stays)', () => {
    expect(nextRoomState('hibernated', { type: 'no-messages' })).toBe('hibernated');
  });

  // ─── Load-failed ──────────────────────────────────────────
  it('load-failed + connection before interval → load-failed (stay)', () => {
    setLoadFailedTime(Date.now() - 1000); // 1 second ago
    expect(nextRoomState('load-failed', { type: 'connection' })).toBe('load-failed');
  });

  it('load-failed + connection after interval → loading (retry)', () => {
    setLoadFailedTime(Date.now() - 6000); // 6 seconds ago
    expect(nextRoomState('load-failed', { type: 'connection' })).toBe('loading');
  });

  it('load-failed + retry-after-interval → loading', () => {
    expect(nextRoomState('load-failed', { type: 'retry-after-interval' })).toBe('loading');
  });

  it('load-failed + invalid event stays load-failed', () => {
    setLoadFailedTime(Date.now() - 6000);
    expect(nextRoomState('load-failed', { type: 'load-ok' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'no-messages' })).toBe('load-failed');
  });
});
