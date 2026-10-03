// Unit tests for the room state transition function (TC-27).
// Covers every edge of the room state diagram and invalid events.

import { describe, expect, it } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

describe('persist.room state transitions (TC-27)', () => {
  const NOW = 1_000_000;

  describe('loading state', () => {
    it('Loading → Ready on load-success', () => {
      expect(nextRoomState('loading', { type: 'load-success', quarantined: 0 })).toBe('ready');
    });

    it('Loading → Ready on load-success (quarantined)', () => {
      expect(nextRoomState('loading', { type: 'load-success', quarantined: 3 })).toBe('ready');
    });

    it('Loading → LoadFailed on load-failed', () => {
      expect(nextRoomState('loading', { type: 'load-failed', reason: 'snapshot-unreadable' })).toBe('load-failed');
    });

    it('Loading stays on invalid events', () => {
      expect(nextRoomState('loading', { type: 'hibernate' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'wake', now: NOW })).toBe('loading');
      expect(nextRoomState('loading', { type: 'storage-failed' })).toBe('loading');
    });
  });

  describe('ready state', () => {
    it('Ready → Ready on update-stored', () => {
      expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
    });

    it('Ready → Ready on compaction-success', () => {
      expect(nextRoomState('ready', { type: 'compaction-success' })).toBe('ready');
    });

    it('Ready → Ready on compaction-rollback', () => {
      expect(nextRoomState('ready', { type: 'compaction-rollback' })).toBe('ready');
    });

    it('Ready → StorageFailed on storage-failed', () => {
      expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
    });

    it('Ready → Hibernated on hibernate', () => {
      expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    });

    it('Ready stays on invalid events', () => {
      expect(nextRoomState('ready', { type: 'load-success', quarantined: 0 })).toBe('ready');
      expect(nextRoomState('ready', { type: 'load-failed', reason: 'x' })).toBe('ready');
    });
  });

  describe('load-failed state', () => {
    it('LoadFailed → Loading on wake after interval elapsed', () => {
      const lastAt = NOW - LOAD_RETRY_MIN_INTERVAL_MS;
      expect(nextRoomState('load-failed', { type: 'retry-load', now: NOW, lastFailedAt: lastAt })).toBe('loading');
    });

    it('LoadFailed → Loading on wake after interval (exactly at boundary)', () => {
      const lastAt = NOW - LOAD_RETRY_MIN_INTERVAL_MS;
      expect(nextRoomState('load-failed', { type: 'retry-load', now: NOW, lastFailedAt: lastAt })).toBe('loading');
    });

    it('LoadFailed stays LoadFailed on wake before interval', () => {
      const lastAt = NOW - (LOAD_RETRY_MIN_INTERVAL_MS - 1);
      expect(nextRoomState('load-failed', { type: 'retry-load', now: NOW, lastFailedAt: lastAt })).toBe('load-failed');
    });

    it('LoadFailed stays on invalid events', () => {
      expect(nextRoomState('load-failed', { type: 'update-stored' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe('load-failed');
    });
  });

  describe('storage-failed state', () => {
    it('StorageFailed → Loading on wake', () => {
      expect(nextRoomState('storage-failed', { type: 'wake', now: NOW })).toBe('loading');
    });

    it('StorageFailed stays on invalid events', () => {
      expect(nextRoomState('storage-failed', { type: 'update-stored' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'hibernate' })).toBe('storage-failed');
    });
  });

  describe('hibernated state', () => {
    it('Hibernated → Loading on wake', () => {
      expect(nextRoomState('hibernated', { type: 'wake', now: NOW })).toBe('loading');
    });

    it('Hibernated stays on invalid events', () => {
      expect(nextRoomState('hibernated', { type: 'update-stored' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'storage-failed' })).toBe('hibernated');
    });
  });
});
