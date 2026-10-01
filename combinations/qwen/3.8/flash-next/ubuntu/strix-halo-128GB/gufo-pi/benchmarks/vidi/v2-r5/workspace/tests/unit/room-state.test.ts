import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/shared/room-state';

describe('TC-27: nextRoomState covers every edge of the room state diagram', () => {
  // Loading → Ready (load-success)
  it('loading + load-success → ready', () => {
    expect(nextRoomState('loading', 'load-success')).toBe('ready');
  });

  // Loading → Ready (load-quarantined)
  it('loading + load-quarantined → ready', () => {
    expect(nextRoomState('loading', 'load-quarantined')).toBe('ready');
  });

  // Loading → LoadFailed
  it('loading + load-failed → load-failed', () => {
    expect(nextRoomState('loading', 'load-failed')).toBe('load-failed');
  });

  // Ready → Compacting
  it('ready + compact-start → compacting', () => {
    expect(nextRoomState('ready', 'compact-start')).toBe('compacting');
  });

  // Compacting → Ready (success)
  it('compacting + compact-success → ready', () => {
    expect(nextRoomState('compacting', 'compact-success')).toBe('ready');
  });

  // Compacting → Ready (rollback)
  it('compacting + compact-rollback → ready', () => {
    expect(nextRoomState('compacting', 'compact-rollback')).toBe('ready');
  });

  // Ready → StorageFailed
  it('ready + storage-error → storage-failed', () => {
    expect(nextRoomState('ready', 'storage-error')).toBe('storage-failed');
  });

  // StorageFailed → Loading (wake)
  it('storage-failed + wake → loading', () => {
    expect(nextRoomState('storage-failed', 'wake')).toBe('loading');
  });

  // Ready → Hibernated
  it('ready + hibernate → hibernated', () => {
    expect(nextRoomState('ready', 'hibernate')).toBe('hibernated');
  });

  // Hibernated → Loading (wake)
  it('hibernated + wake → loading', () => {
    expect(nextRoomState('hibernated', 'wake')).toBe('loading');
  });

  // LoadFailed → Loading (retry-load, after LOAD_RETRY_MIN_INTERVAL_MS)
  it('load-failed + retry-load → loading', () => {
    expect(nextRoomState('load-failed', 'retry-load')).toBe('loading');
  });

  // LoadFailed → LoadFailed (retry-reject, before interval)
  it('load-failed + retry-reject → load-failed', () => {
    expect(nextRoomState('load-failed', 'retry-reject')).toBe('load-failed');
  });

  // Negative: invalid events leave state unchanged
  it('loading + storage-error → loading (invalid)', () => {
    expect(nextRoomState('loading', 'storage-error')).toBe('loading');
  });

  it('ready + load-success → ready (invalid)', () => {
    expect(nextRoomState('ready', 'load-success')).toBe('ready');
  });

  it('compacting + storage-error → compacting (invalid)', () => {
    expect(nextRoomState('compacting', 'storage-error')).toBe('compacting');
  });

  it('load-failed + hibernate → load-failed (invalid)', () => {
    expect(nextRoomState('load-failed', 'hibernate')).toBe('load-failed');
  });

  it('hibernated + compact-start → hibernated (invalid)', () => {
    expect(nextRoomState('hibernated', 'compact-start')).toBe('hibernated');
  });

  it('storage-failed + load-success → storage-failed (invalid)', () => {
    expect(nextRoomState('storage-failed', 'load-success')).toBe('storage-failed');
  });
});
