import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

describe('persist.room: room state transitions (TC-27)', () => {
  describe('every edge of the room state diagram', () => {
    it('Loading → Ready when snapshot and log applied', () => {
      expect(nextRoomState('loading', { type: 'load-ok', quarantined: 0 })).toBe('ready');
    });

    it('Loading → Ready when log rows quarantined, rest applied', () => {
      expect(nextRoomState('loading', { type: 'load-ok', quarantined: 3 })).toBe('ready');
    });

    it('Loading → LoadFailed when snapshot unreadable or SQL error', () => {
      expect(nextRoomState('loading', { type: 'load-failed', reason: 'snapshot-unreadable' })).toBe('load-failed');
      expect(nextRoomState('loading', { type: 'load-failed', reason: 'sql-error' })).toBe('load-failed');
    });

    it('Ready → Ready when an update is applied, stored, broadcast', () => {
      expect(nextRoomState('ready', { type: 'update' })).toBe('ready');
    });

    it('Ready → Compacting when the log exceeds the threshold', () => {
      expect(nextRoomState('ready', { type: 'compact-start' })).toBe('compacting');
    });

    it('Compacting → Ready when the snapshot replaced the log', () => {
      expect(nextRoomState('compacting', { type: 'compact-done' })).toBe('ready');
    });

    it('Compacting → Ready when compaction errored and rolled back (log intact)', () => {
      expect(nextRoomState('compacting', { type: 'compact-rolled-back' })).toBe('ready');
    });

    it('Ready → StorageFailed when an insert throws', () => {
      expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
    });

    it('StorageFailed → Loading on the next connection (sockets closed, doc discarded)', () => {
      expect(nextRoomState('storage-failed', { type: 'wake', elapsedMs: 0 })).toBe('loading');
    });

    it('Ready → Hibernated when there are no events', () => {
      expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    });

    it('Hibernated → Loading when a message or new connection wakes the object', () => {
      expect(nextRoomState('hibernated', { type: 'wake', elapsedMs: 12345 })).toBe('loading');
    });

    it('LoadFailed → Loading on a new connection after LOAD_RETRY_MIN_INTERVAL_MS', () => {
      expect(
        nextRoomState('load-failed', { type: 'wake', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS })
      ).toBe('loading');
      expect(
        nextRoomState('load-failed', { type: 'wake', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 })
      ).toBe('loading');
    });

    it('LoadFailed → LoadFailed on a connection before the interval (closed 4500)', () => {
      expect(
        nextRoomState('load-failed', { type: 'wake', elapsedMs: 0 })
      ).toBe('load-failed');
      expect(
        nextRoomState('load-failed', { type: 'wake', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 })
      ).toBe('load-failed');
    });
  });

  describe('invalid events leave the state unchanged (negative)', () => {
    const invalidEvents: Array<[RoomState, RoomEvent]> = [
      // loading
      ['loading', { type: 'update' }],
      ['loading', { type: 'compact-start' }],
      ['loading', { type: 'compact-done' }],
      ['loading', { type: 'compact-rolled-back' }],
      ['loading', { type: 'storage-failed' }],
      ['loading', { type: 'hibernate' }],
      ['loading', { type: 'wake', elapsedMs: 0 }],
      // ready
      ['ready', { type: 'load-ok', quarantined: 0 }],
      ['ready', { type: 'load-failed', reason: 'sql-error' }],
      ['ready', { type: 'compact-done' }],
      ['ready', { type: 'compact-rolled-back' }],
      ['ready', { type: 'wake', elapsedMs: 0 }],
      // load-failed
      ['load-failed', { type: 'load-ok', quarantined: 0 }],
      ['load-failed', { type: 'update' }],
      ['load-failed', { type: 'compact-start' }],
      ['load-failed', { type: 'compact-done' }],
      ['load-failed', { type: 'storage-failed' }],
      ['load-failed', { type: 'hibernate' }],
      // storage-failed
      ['storage-failed', { type: 'load-ok', quarantined: 0 }],
      ['storage-failed', { type: 'update' }],
      ['storage-failed', { type: 'compact-start' }],
      ['storage-failed', { type: 'hibernate' }],
      // compacting
      ['compacting', { type: 'load-ok', quarantined: 0 }],
      ['compacting', { type: 'load-failed', reason: 'sql-error' }],
      ['compacting', { type: 'update' }],
      ['compacting', { type: 'compact-start' }],
      ['compacting', { type: 'storage-failed' }],
      ['compacting', { type: 'hibernate' }],
      ['compacting', { type: 'wake', elapsedMs: 0 }],
      // hibernated
      ['hibernated', { type: 'load-ok', quarantined: 0 }],
      ['hibernated', { type: 'load-failed', reason: 'sql-error' }],
      ['hibernated', { type: 'update' }],
      ['hibernated', { type: 'compact-start' }],
      ['hibernated', { type: 'compact-done' }],
      ['hibernated', { type: 'storage-failed' }],
      ['hibernated', { type: 'hibernate' }],
    ];

    for (const [state, event] of invalidEvents) {
      it(`${state} + ${event.type} → unchanged`, () => {
        expect(nextRoomState(state, event)).toBe(state);
      });
    }
  });
});
