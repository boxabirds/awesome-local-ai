/**
 * TC-27: nextRoomState covers every edge of the room state diagram and invalid events.
 */
import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/worker/room-state';

describe('TC-27: nextRoomState transitions', () => {
  // Loading → Ready (success)
  it('loading + load-success → ready', () => {
    expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
  });

  // Loading → Ready (quarantined)
  it('loading + load-success-quarantined → ready', () => {
    expect(nextRoomState('loading', { type: 'load-success-quarantined' })).toBe('ready');
  });

  // Loading → LoadFailed
  it('loading + load-failed → load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  // Ready → Compacting
  it('ready + compact-start → compacting', () => {
    expect(nextRoomState('ready', { type: 'compact-start' })).toBe('compacting');
  });

  // Compacting → Ready (success)
  it('compacting + compact-success → ready', () => {
    expect(nextRoomState('compacting', { type: 'compact-success' })).toBe('ready');
  });

  // Compacting → Ready (rollback)
  it('compacting + compact-rollback → ready', () => {
    expect(nextRoomState('compacting', { type: 'compact-rollback' })).toBe('ready');
  });

  // Ready → StorageFailed
  it('ready + storage-error → storage-failed', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
  });

  // StorageFailed → Loading (wake/next connection)
  it('storage-failed + wake → loading', () => {
    expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
  });

  // Ready → Hibernated
  it('ready + hibernate → hibernated', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
  });

  // Hibernated → Loading (message or new connection)
  it('hibernated + wake → loading', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  // LoadFailed → Loading (retry after interval)
  it('load-failed + retry-load → loading', () => {
    expect(nextRoomState('load-failed', { type: 'retry-load' })).toBe('loading');
  });

  // LoadFailed → LoadFailed (retry before interval)
  it('load-failed + retry-rejected → load-failed', () => {
    expect(nextRoomState('load-failed', { type: 'retry-rejected' })).toBe('load-failed');
  });

  // Negative: invalid events leave state unchanged
  it('loading + compact-start → loading (invalid)', () => {
    expect(nextRoomState('loading', { type: 'compact-start' })).toBe('loading');
  });

  it('loading + storage-error → loading (invalid)', () => {
    expect(nextRoomState('loading', { type: 'storage-error' })).toBe('loading');
  });

  it('loading + hibernate → loading (invalid)', () => {
    expect(nextRoomState('loading', { type: 'hibernate' })).toBe('loading');
  });

  it('ready + load-success → ready (invalid)', () => {
    expect(nextRoomState('ready', { type: 'load-success' })).toBe('ready');
  });

  it('ready + load-failed → ready (invalid)', () => {
    expect(nextRoomState('ready', { type: 'load-failed' })).toBe('ready');
  });

  it('ready + wake → ready (invalid)', () => {
    expect(nextRoomState('ready', { type: 'wake' })).toBe('ready');
  });

  it('ready + retry-load → ready (invalid)', () => {
    expect(nextRoomState('ready', { type: 'retry-load' })).toBe('ready');
  });

  it('compacting + storage-error → compacting (invalid)', () => {
    expect(nextRoomState('compacting', { type: 'storage-error' })).toBe('compacting');
  });

  it('compacting + compact-start → compacting (invalid)', () => {
    expect(nextRoomState('compacting', { type: 'compact-start' })).toBe('compacting');
  });

  it('storage-failed + load-success → storage-failed (invalid)', () => {
    expect(nextRoomState('storage-failed', { type: 'load-success' })).toBe('storage-failed');
  });

  it('storage-failed + compact-start → storage-failed (invalid)', () => {
    expect(nextRoomState('storage-failed', { type: 'compact-start' })).toBe('storage-failed');
  });

  it('load-failed + load-success → load-failed (invalid)', () => {
    expect(nextRoomState('load-failed', { type: 'load-success' })).toBe('load-failed');
  });

  it('load-failed + storage-error → load-failed (invalid)', () => {
    expect(nextRoomState('load-failed', { type: 'storage-error' })).toBe('load-failed');
  });

  it('hibernated + load-success → hibernated (invalid)', () => {
    expect(nextRoomState('hibernated', { type: 'load-success' })).toBe('hibernated');
  });

  it('hibernated + compact-start → hibernated (invalid)', () => {
    expect(nextRoomState('hibernated', { type: 'compact-start' })).toBe('hibernated');
  });
});
