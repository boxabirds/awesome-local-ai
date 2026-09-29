import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';

describe('TC-27: nextRoomState covers every edge of the room lifecycle diagram', () => {
  describe('Loading state', () => {
    it('Loading → Ready on load-success', () => {
      const r = nextRoomState('loading', { type: 'load-success', quarantined: 0 });
      expect(r.state).toBe('ready');
    });

    it('Loading → Ready on load-success with quarantined rows', () => {
      const r = nextRoomState('loading', { type: 'load-success', quarantined: 3 });
      expect(r.state).toBe('ready');
    });

    it('Loading → LoadFailed on load-failed', () => {
      const r = nextRoomState('loading', { type: 'load-failed' });
      expect(r.state).toBe('load-failed');
    });

    it('Loading ignores invalid events', () => {
      const invalidEvents: RoomEvent[] = [
        { type: 'update-applied' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'wake' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalidEvents) {
        expect(nextRoomState('loading', event).state).toBe('loading');
      }
    });
  });

  describe('Ready state', () => {
    it('Ready → Compacting on compact-start', () => {
      const r = nextRoomState('ready', { type: 'compact-start' });
      expect(r.state).toBe('compacting');
    });

    it('Ready → StorageFailed on storage-error', () => {
      const r = nextRoomState('ready', { type: 'storage-error' });
      expect(r.state).toBe('storage-failed');
    });

    it('Ready → Hibernated on hibernate', () => {
      const r = nextRoomState('ready', { type: 'hibernate' });
      expect(r.state).toBe('hibernated');
    });

    it('Ready stays Ready on update-applied (stays ready)', () => {
      const r = nextRoomState('ready', { type: 'update-applied' });
      expect(r.state).toBe('ready');
    });

    it('Ready ignores invalid events', () => {
      const invalidEvents: RoomEvent[] = [
        { type: 'load-success', quarantined: 0 },
        { type: 'load-failed' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'wake' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalidEvents) {
        expect(nextRoomState('ready', event).state).toBe('ready');
      }
    });
  });

  describe('Compacting state', () => {
    it('Compacting → Ready on compact-success', () => {
      const r = nextRoomState('compacting', { type: 'compact-success' });
      expect(r.state).toBe('ready');
    });

    it('Compacting → Ready on compact-rollback', () => {
      const r = nextRoomState('compacting', { type: 'compact-rollback' });
      expect(r.state).toBe('ready');
    });

    it('Compacting ignores invalid events', () => {
      const invalidEvents: RoomEvent[] = [
        { type: 'load-success', quarantined: 0 },
        { type: 'load-failed' },
        { type: 'update-applied' },
        { type: 'compact-start' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'wake' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalidEvents) {
        expect(nextRoomState('compacting', event).state).toBe('compacting');
      }
    });
  });

  describe('LoadFailed state', () => {
    it('LoadFailed → Loading on retry-load-allowed', () => {
      const r = nextRoomState('load-failed', { type: 'retry-load-allowed' });
      expect(r.state).toBe('loading');
    });

    it('LoadFailed stays LoadFailed on retry-load-denied with close code 4500', () => {
      const r = nextRoomState('load-failed', { type: 'retry-load-denied' });
      expect(r.state).toBe('load-failed');
      expect(r.closeCode).toBe(4500);
    });

    it('LoadFailed ignores invalid events', () => {
      const invalidEvents: RoomEvent[] = [
        { type: 'load-success', quarantined: 0 },
        { type: 'load-failed' },
        { type: 'update-applied' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'wake' },
      ];
      for (const event of invalidEvents) {
        expect(nextRoomState('load-failed', event).state).toBe('load-failed');
      }
    });
  });

  describe('StorageFailed state', () => {
    it('StorageFailed → Loading on wake', () => {
      const r = nextRoomState('storage-failed', { type: 'wake' });
      expect(r.state).toBe('loading');
    });

    it('StorageFailed ignores invalid events', () => {
      const invalidEvents: RoomEvent[] = [
        { type: 'load-success', quarantined: 0 },
        { type: 'load-failed' },
        { type: 'update-applied' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalidEvents) {
        expect(nextRoomState('storage-failed', event).state).toBe('storage-failed');
      }
    });
  });

  describe('Hibernated state', () => {
    it('Hibernated → Loading on wake', () => {
      const r = nextRoomState('hibernated', { type: 'wake' });
      expect(r.state).toBe('loading');
    });

    it('Hibernated ignores invalid events', () => {
      const invalidEvents: RoomEvent[] = [
        { type: 'load-success', quarantined: 0 },
        { type: 'load-failed' },
        { type: 'update-applied' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalidEvents) {
        expect(nextRoomState('hibernated', event).state).toBe('hibernated');
      }
    });
  });
});
