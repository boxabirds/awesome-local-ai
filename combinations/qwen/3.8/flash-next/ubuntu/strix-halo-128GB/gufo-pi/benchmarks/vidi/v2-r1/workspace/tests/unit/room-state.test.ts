import { describe, expect, it } from 'vitest';

import { nextRoomState, type RoomEvent, type RoomState } from '../../src/worker/room-state';

describe('nextRoomState (TC-27)', () => {
  describe('Loading transitions', () => {
    it('Loading → Ready on load-success', () => {
      expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
    });

    it('Loading → Ready on load-success-quarantined', () => {
      expect(nextRoomState('loading', { type: 'load-success-quarantined' })).toBe('ready');
    });

    it('Loading → LoadFailed on load-failed', () => {
      expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
    });

    it('Loading: invalid events leave state unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'compact-start' },
        { type: 'compact-done' },
        { type: 'compact-error' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'wake' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('loading', event)).toBe('loading');
      }
    });
  });

  describe('Ready transitions', () => {
    it('Ready → Compacting on compact-start', () => {
      expect(nextRoomState('ready', { type: 'compact-start' })).toBe('compacting');
    });

    it('Ready → StorageFailed on storage-error', () => {
      expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
    });

    it('Ready → Hibernated on hibernate', () => {
      expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    });

    it('Ready: invalid events leave state unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-success-quarantined' },
        { type: 'load-failed' },
        { type: 'compact-done' },
        { type: 'compact-error' },
        { type: 'wake' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('ready', event)).toBe('ready');
      }
    });
  });

  describe('Compacting transitions', () => {
    it('Compacting → Ready on compact-done (success)', () => {
      expect(nextRoomState('compacting', { type: 'compact-done' })).toBe('ready');
    });

    it('Compacting → Ready on compact-error (rollback)', () => {
      expect(nextRoomState('compacting', { type: 'compact-error' })).toBe('ready');
    });

    it('Compacting: invalid events leave state unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'wake' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('compacting', event)).toBe('compacting');
      }
    });
  });

  describe('StorageFailed transitions', () => {
    it('StorageFailed → Loading on wake (next connection reloads)', () => {
      expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
    });

    it('StorageFailed: invalid events leave state unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'compact-done' },
        { type: 'compact-error' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('storage-failed', event)).toBe('storage-failed');
      }
    });
  });

  describe('Hibernated transitions', () => {
    it('Hibernated → Loading on wake', () => {
      expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    });

    it('Hibernated: invalid events leave state unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'compact-done' },
        { type: 'compact-error' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'retry-load-allowed' },
        { type: 'retry-load-denied' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('hibernated', event)).toBe('hibernated');
      }
    });
  });

  describe('LoadFailed transitions', () => {
    it('LoadFailed → Loading on retry-load-allowed (after LOAD_RETRY_MIN_INTERVAL_MS)', () => {
      expect(nextRoomState('load-failed', { type: 'retry-load-allowed' })).toBe('loading');
    });

    it('LoadFailed → LoadFailed on retry-load-denied (before interval, close 4500)', () => {
      expect(nextRoomState('load-failed', { type: 'retry-load-denied' })).toBe('load-failed');
    });

    it('LoadFailed: invalid events leave state unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'compact-done' },
        { type: 'compact-error' },
        { type: 'storage-error' },
        { type: 'hibernate' },
        { type: 'wake' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('load-failed', event)).toBe('load-failed');
      }
    });
  });

  describe('all states covered', () => {
    const allStates: RoomState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
    const allEvents: RoomEvent['type'][] = [
      'load-success', 'load-success-quarantined', 'load-failed',
      'compact-start', 'compact-done', 'compact-error',
      'storage-error', 'hibernate', 'wake',
      'retry-load-allowed', 'retry-load-denied',
    ];

    it('every (state, event) pair returns a valid state', () => {
      for (const state of allStates) {
        for (const eventType of allEvents) {
          const result = nextRoomState(state, { type: eventType } as RoomEvent);
          expect(allStates).toContain(result);
        }
      }
    });
  });
});
