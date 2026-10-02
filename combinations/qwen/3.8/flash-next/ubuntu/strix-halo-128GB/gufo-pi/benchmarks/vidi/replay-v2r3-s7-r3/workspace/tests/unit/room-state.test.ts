import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';

describe('nextRoomState (TC-27)', () => {
  describe('Loading state transitions', () => {
    it('load-success → ready', () => {
      expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
    });

    it('load-success-quarantined → ready', () => {
      expect(nextRoomState('loading', { type: 'load-success-quarantined' })).toBe('ready');
    });

    it('load-failed → load-failed', () => {
      expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
    });

    it('invalid events leave loading unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'storage-recovered' },
        { type: 'hibernate' },
        { type: 'wake' },
        { type: 'retry-load-elapsed' },
        { type: 'retry-load-too-soon' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('loading', event)).toBe('loading');
      }
    });
  });

  describe('Ready state transitions', () => {
    it('compact-start → ready (stays ready during compaction)', () => {
      expect(nextRoomState('ready', { type: 'compact-start' })).toBe('ready');
    });

    it('compact-success → ready', () => {
      expect(nextRoomState('ready', { type: 'compact-success' })).toBe('ready');
    });

    it('compact-rollback → ready', () => {
      expect(nextRoomState('ready', { type: 'compact-rollback' })).toBe('ready');
    });

    it('storage-error → storage-failed', () => {
      expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
    });

    it('hibernate → hibernated', () => {
      expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    });

    it('invalid events leave ready unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-success-quarantined' },
        { type: 'load-failed' },
        { type: 'storage-recovered' },
        { type: 'wake' },
        { type: 'retry-load-elapsed' },
        { type: 'retry-load-too-soon' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('ready', event)).toBe('ready');
      }
    });
  });

  describe('LoadFailed state transitions', () => {
    it('retry-load-elapsed → loading', () => {
      expect(nextRoomState('load-failed', { type: 'retry-load-elapsed' })).toBe('loading');
    });

    it('retry-load-too-soon stays load-failed', () => {
      expect(nextRoomState('load-failed', { type: 'retry-load-too-soon' })).toBe('load-failed');
    });

    it('invalid events leave load-failed unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-success-quarantined' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'storage-recovered' },
        { type: 'hibernate' },
        { type: 'wake' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('load-failed', event)).toBe('load-failed');
      }
    });
  });

  describe('StorageFailed state transitions', () => {
    it('wake → loading', () => {
      expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
    });

    it('invalid events leave storage-failed unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-success-quarantined' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'storage-recovered' },
        { type: 'hibernate' },
        { type: 'retry-load-elapsed' },
        { type: 'retry-load-too-soon' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('storage-failed', event)).toBe('storage-failed');
      }
    });
  });

  describe('Hibernated state transitions', () => {
    it('wake → loading', () => {
      expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    });

    it('invalid events leave hibernated unchanged', () => {
      const invalid: RoomEvent[] = [
        { type: 'load-success' },
        { type: 'load-success-quarantined' },
        { type: 'load-failed' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'compact-rollback' },
        { type: 'storage-error' },
        { type: 'storage-recovered' },
        { type: 'hibernate' },
        { type: 'retry-load-elapsed' },
        { type: 'retry-load-too-soon' },
      ];
      for (const event of invalid) {
        expect(nextRoomState('hibernated', event)).toBe('hibernated');
      }
    });
  });
});
