import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

describe('TC-27: nextRoomState covers every edge of the room lifecycle diagram', () => {
  describe('Loading transitions', () => {
    it('Loading → Ready on load-success', () => {
      expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
    });

    it('Loading → Ready on load-success with quarantined rows', () => {
      expect(nextRoomState('loading', { type: 'load-success', quarantined: 3 })).toBe('ready');
    });

    it('Loading → LoadFailed on load-failed', () => {
      expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
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

    it('Ready ignores compact-success (invalid event)', () => {
      expect(nextRoomState('ready', { type: 'compact-success' })).toBe('ready');
    });

    it('Ready ignores compact-rollback (invalid event)', () => {
      expect(nextRoomState('ready', { type: 'compact-rollback' })).toBe('ready');
    });

    it('Ready ignores wake (invalid event)', () => {
      expect(nextRoomState('ready', { type: 'wake' })).toBe('ready');
    });
  });

  describe('Compacting transitions', () => {
    it('Compacting → Ready on compact-success', () => {
      expect(nextRoomState('compacting', { type: 'compact-success' })).toBe('ready');
    });

    it('Compacting → Ready on compact-rollback', () => {
      expect(nextRoomState('compacting', { type: 'compact-rollback' })).toBe('ready');
    });
  });

  describe('StorageFailed transitions', () => {
    it('StorageFailed → Loading on wake (next connection reloads)', () => {
      expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
    });
  });

  describe('Hibernated transitions', () => {
    it('Hibernated → Loading on wake', () => {
      expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    });
  });

  describe('LoadFailed transitions', () => {
    it('LoadFailed → Loading when connection arrives after LOAD_RETRY_MIN_INTERVAL_MS', () => {
      const now = 10000;
      const lastFail = now - LOAD_RETRY_MIN_INTERVAL_MS;
      expect(nextRoomState('load-failed', { type: 'connection', timestamp: now, lastLoadFailedTime: lastFail })).toBe('loading');
    });

    it('LoadFailed → Loading when connection arrives exactly at LOAD_RETRY_MIN_INTERVAL_MS', () => {
      const now = 10000;
      const lastFail = now - LOAD_RETRY_MIN_INTERVAL_MS;
      expect(nextRoomState('load-failed', { type: 'connection', timestamp: now, lastLoadFailedTime: lastFail })).toBe('loading');
    });

    it('LoadFailed stays LoadFailed when connection arrives before LOAD_RETRY_MIN_INTERVAL_MS', () => {
      const now = 10000;
      const lastFail = now - LOAD_RETRY_MIN_INTERVAL_MS + 1;
      expect(nextRoomState('load-failed', { type: 'connection', timestamp: now, lastLoadFailedTime: lastFail })).toBe('load-failed');
    });

    it('LoadFailed stays LoadFailed when connection arrives well before interval', () => {
      const now = 10000;
      const lastFail = now - 100;
      expect(nextRoomState('load-failed', { type: 'connection', timestamp: now, lastLoadFailedTime: lastFail })).toBe('load-failed');
    });

    it('LoadFailed stays LoadFailed on invalid events', () => {
      expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'compact-start' })).toBe('load-failed');
    });
  });
});
