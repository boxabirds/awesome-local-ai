import { describe, expect, it } from 'vitest';
import { nextRoomState, type RoomEvent, type RoomState } from '../../src/worker/room-state';

describe('nextRoomState', () => {
  describe('happy-path transitions', () => {
    it('Loading + loaded -> Ready', () => {
      expect(nextRoomState('loading', { type: 'loaded', quarantined: 0 })).toBe('ready');
    });

    it('Loading + loaded (quarantined rows) -> Ready', () => {
      expect(nextRoomState('loading', { type: 'loaded', quarantined: 3 })).toBe('ready');
    });

    it('Loading + load-failed -> LoadFailed', () => {
      expect(nextRoomState('loading', { type: 'load-failed', reason: 'snapshot-unreadable' })).toBe(
        'load-failed',
      );
    });

    it('Ready + compaction-start -> Compacting', () => {
      expect(nextRoomState('ready', { type: 'compaction-start' })).toBe('compacting');
    });

    it('Compacting + compaction-done (success) -> Ready', () => {
      expect(nextRoomState('compacting', { type: 'compaction-done', success: true })).toBe('ready');
    });

    it('Compacting + compaction-done (rollback) -> Ready', () => {
      expect(nextRoomState('compacting', { type: 'compaction-done', success: false })).toBe('ready');
    });

    it('Ready + storage-failed -> StorageFailed', () => {
      expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
    });

    it('StorageFailed + connected -> Loading (doc discarded, next connection reloads)', () => {
      expect(nextRoomState('storage-failed', { type: 'connected', retryAllowed: true })).toBe(
        'loading',
      );
    });

    it('Ready + hibernated -> Hibernated', () => {
      expect(nextRoomState('ready', { type: 'hibernated' })).toBe('hibernated');
    });

    it('Hibernated + woken -> Loading (message or new connection wakes the object)', () => {
      expect(nextRoomState('hibernated', { type: 'woken' })).toBe('loading');
    });

    it('LoadFailed + connected after the retry interval -> Loading', () => {
      expect(nextRoomState('load-failed', { type: 'connected', retryAllowed: true })).toBe(
        'loading',
      );
    });

    it('LoadFailed + connected before the retry interval -> LoadFailed (closes 4500, no reload attempt)', () => {
      expect(nextRoomState('load-failed', { type: 'connected', retryAllowed: false })).toBe(
        'load-failed',
      );
    });

    it('Ready + connected -> Ready (a live room just serves the connection)', () => {
      expect(nextRoomState('ready', { type: 'connected', retryAllowed: true })).toBe('ready');
    });
  });

  describe('invalid events leave the state unchanged (negative)', () => {
    const cases: Array<[RoomState, RoomEvent]> = [
      // Loading accepts only load results and hibernation.
      ['loading', { type: 'connected', retryAllowed: true }],
      ['loading', { type: 'compaction-start' }],
      ['loading', { type: 'storage-failed' }],
      ['loading', { type: 'hibernated' }],
      ['loading', { type: 'woken' }],
      // Ready is a terminal-ish serving state apart from its own events.
      ['ready', { type: 'loaded', quarantined: 0 }],
      ['ready', { type: 'load-failed', reason: 'x' }],
      ['ready', { type: 'woken' }],
      // Compacting is atomic; only its own completion event applies.
      ['compacting', { type: 'connected', retryAllowed: true }],
      ['compacting', { type: 'storage-failed' }],
      ['compacting', { type: 'loaded', quarantined: 0 }],
      // StorageFailed only advances on a new connection.
      ['storage-failed', { type: 'loaded', quarantined: 0 }],
      ['storage-failed', { type: 'woken' }],
      ['storage-failed', { type: 'hibernated' }],
      // LoadFailed only advances on a permitted retry.
      ['load-failed', { type: 'loaded', quarantined: 0 }],
      ['load-failed', { type: 'storage-failed' }],
      ['load-failed', { type: 'woken' }],
      ['load-failed', { type: 'hibernated' }],
      // Hibernated only advances on a wake.
      ['hibernated', { type: 'connected', retryAllowed: true }],
      ['hibernated', { type: 'storage-failed' }],
      ['hibernated', { type: 'loaded', quarantined: 0 }],
    ];

    it.each(cases.map(([state, event]) => [state, event] as const))(
      '%s + %s -> %s (unchanged)',
      (state, event) => {
        expect(nextRoomState(state, event)).toBe(state);
      },
    );
  });
});
