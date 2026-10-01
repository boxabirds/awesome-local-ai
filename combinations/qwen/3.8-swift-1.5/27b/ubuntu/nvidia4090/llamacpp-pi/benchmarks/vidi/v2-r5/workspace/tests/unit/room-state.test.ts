// tests/unit/room-state.test.ts
// Unit tests for nextRoomState covering every edge of the room state diagram (TC-27)

import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/worker/room-state';

describe('persist.room: nextRoomState (TC-27)', () => {
  // Loading → Ready
  it('Loading → Ready on load-success', () => {
    expect(nextRoomState('loading', { type: 'load-success', quarantined: 0 })).toBe('ready');
  });

  // Loading → Ready (with quarantined)
  it('Loading → Ready on load-success with quarantined > 0', () => {
    expect(nextRoomState('loading', { type: 'load-success', quarantined: 3 })).toBe('ready');
  });

  // Loading → LoadFailed
  it('Loading → LoadFailed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed', reason: 'snapshot-unreadable' })).toBe('load-failed');
  });

  // Ready → Compacting → Ready (success)
  it('Ready stays Ready on compact-start', () => {
    expect(nextRoomState('ready', { type: 'compact-start' })).toBe('ready');
  });

  it('Ready stays Ready on compact-success', () => {
    expect(nextRoomState('ready', { type: 'compact-success' })).toBe('ready');
  });

  // Ready → Compacting → Ready (rollback)
  it('Ready stays Ready on compact-rollback', () => {
    expect(nextRoomState('ready', { type: 'compact-rollback' })).toBe('ready');
  });

  // Ready → StorageFailed
  it('Ready → StorageFailed on storage-failed', () => {
    expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
  });

  // StorageFailed → Loading
  it('StorageFailed → Loading on reload', () => {
    expect(nextRoomState('storage-failed', { type: 'reload' })).toBe('loading');
  });

  it('StorageFailed → Loading on wake', () => {
    expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
  });

  // Ready → Hibernated
  it('Ready → Hibernated on hibernate', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
  });

  // Hibernated → Loading
  it('Hibernated → Loading on wake', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  // LoadFailed → Loading (after interval)
  it('LoadFailed → Loading on retry-eligible', () => {
    expect(nextRoomState('load-failed', { type: 'retry-eligible' })).toBe('loading');
  });

  it('LoadFailed → Loading on wake', () => {
    expect(nextRoomState('load-failed', { type: 'wake' })).toBe('loading');
  });

  // Invalid events leave state unchanged
  describe('invalid events leave state unchanged', () => {
    it('loading: most events are invalid', () => {
      // Only load-success and load-failed are valid for loading
      expect(nextRoomState('loading', { type: 'update-stored' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'compact-start' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'hibernate' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'wake' })).toBe('loading');
    });

    it('ready: load events are invalid', () => {
      expect(nextRoomState('ready', { type: 'load-success', quarantined: 0 })).toBe('ready');
      expect(nextRoomState('ready', { type: 'load-failed', reason: 'x' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'reload' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'retry-eligible' })).toBe('ready');
    });

    it('load-failed: most events are invalid', () => {
      expect(nextRoomState('load-failed', { type: 'load-success', quarantined: 0 })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'storage-failed' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe('load-failed');
    });

    it('storage-failed: most events are invalid', () => {
      expect(nextRoomState('storage-failed', { type: 'load-success', quarantined: 0 })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'storage-failed' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'hibernate' })).toBe('storage-failed');
    });

    it('hibernated: most events are invalid', () => {
      expect(nextRoomState('hibernated', { type: 'load-success', quarantined: 0 })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'storage-failed' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'hibernate' })).toBe('hibernated');
    });
  });
});
