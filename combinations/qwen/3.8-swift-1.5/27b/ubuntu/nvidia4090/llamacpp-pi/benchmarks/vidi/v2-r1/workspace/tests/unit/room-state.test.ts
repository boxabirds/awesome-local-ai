import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/worker/room-state';

describe('TC-27: nextRoomState covers every edge of the room state diagram', () => {
  describe('Loading state', () => {
    it('Loading → Ready on load-success', () => {
      expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
    });

    it('Loading → Ready on load-success (quarantined is still success)', () => {
      // Quarantined rows still result in a successful load
      expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
    });

    it('Loading → LoadFailed on load-failed', () => {
      expect(nextRoomState('loading', { type: 'load-failed', error: 'sql-error' })).toBe('load-failed');
    });

    it('Loading stays on invalid events', () => {
      expect(nextRoomState('loading', { type: 'update-stored' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'compaction-start' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'storage-failed' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'hibernate' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'wake' })).toBe('loading');
    });
  });

  describe('Ready state', () => {
    it('Ready → Compacting on compaction-start', () => {
      expect(nextRoomState('ready', { type: 'compaction-start' })).toBe('compacting');
    });

    it('Ready → StorageFailed on storage-failed', () => {
      expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
    });

    it('Ready → Hibernated on hibernate', () => {
      expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    });

    it('Ready → Ready on update-stored (stays ready)', () => {
      expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
    });

    it('Ready stays on invalid events', () => {
      expect(nextRoomState('ready', { type: 'load-success' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'load-failed', error: '' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'compaction-success' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'compaction-failed' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'socket-closed' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'wake' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'retry-load' })).toBe('ready');
    });
  });

  describe('LoadFailed state', () => {
    it('LoadFailed → Loading on retry-load (after interval elapsed)', () => {
      expect(nextRoomState('load-failed', { type: 'retry-load' })).toBe('loading');
    });

    it('LoadFailed stays on invalid events (before interval: stays LoadFailed and closes 4500)', () => {
      expect(nextRoomState('load-failed', { type: 'load-success' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'update-stored' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'compaction-start' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'storage-failed' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'wake' })).toBe('load-failed');
    });
  });

  describe('StorageFailed state', () => {
    it('StorageFailed → Loading on socket-closed (all sockets closed, next connection reloads)', () => {
      expect(nextRoomState('storage-failed', { type: 'socket-closed' })).toBe('loading');
    });

    it('StorageFailed stays on invalid events', () => {
      expect(nextRoomState('storage-failed', { type: 'load-success' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'update-stored' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'compaction-start' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'hibernate' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('storage-failed');
    });
  });

  describe('Compacting state', () => {
    it('Compacting → Ready on compaction-success', () => {
      expect(nextRoomState('compacting', { type: 'compaction-success' })).toBe('ready');
    });

    it('Compacting → Ready on compaction-failed (rollback, log intact)', () => {
      expect(nextRoomState('compacting', { type: 'compaction-failed' })).toBe('ready');
    });

    it('Compacting stays on invalid events', () => {
      expect(nextRoomState('compacting', { type: 'load-success' })).toBe('compacting');
      expect(nextRoomState('compacting', { type: 'storage-failed' })).toBe('compacting');
      expect(nextRoomState('compacting', { type: 'hibernate' })).toBe('compacting');
      expect(nextRoomState('compacting', { type: 'wake' })).toBe('compacting');
    });
  });

  describe('Hibernated state', () => {
    it('Hibernated → Loading on wake', () => {
      expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    });

    it('Hibernated stays on invalid events', () => {
      expect(nextRoomState('hibernated', { type: 'load-success' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'update-stored' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'compaction-start' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'storage-failed' })).toBe('hibernated');
    });
  });
});
