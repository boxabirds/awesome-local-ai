/**
 * Unit tests for the room state machine: nextRoomState.
 * TC-27: covers every edge of the room lifecycle diagram.
 */
import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

describe('room state machine (unit)', () => {
  // Loading → Ready
  it('Loading → Ready on load-success', () => {
    expect(nextRoomState('loading', { type: 'load-success' })).toBe('ready');
  });

  // Loading → LoadFailed
  it('Loading → LoadFailed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  // Ready → Ready (update-stored)
  it('Ready → Ready on update-stored', () => {
    expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
  });

  // Ready → Compacting
  it('Ready → Compacting on compaction-start', () => {
    expect(nextRoomState('ready', { type: 'compaction-start' })).toBe('compacting');
  });

  // Compacting → Ready (success)
  it('Compacting → Ready on compaction-success', () => {
    expect(nextRoomState('compacting', { type: 'compaction-success' })).toBe('ready');
  });

  // Compacting → Ready (rollback)
  it('Compacting → Ready on compaction-rollback', () => {
    expect(nextRoomState('compacting', { type: 'compaction-rollback' })).toBe('ready');
  });

  // Ready → StorageFailed
  it('Ready → StorageFailed on storage-failed', () => {
    expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
  });

  // StorageFailed → Loading
  it('StorageFailed → Loading on reset', () => {
    expect(nextRoomState('storage-failed', { type: 'reset' })).toBe('loading');
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
  it('LoadFailed → Loading on retry after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(
      nextRoomState('load-failed', { type: 'retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS }),
    ).toBe('loading');
  });

  it('LoadFailed → Loading on retry well after interval', () => {
    expect(
      nextRoomState('load-failed', { type: 'retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS * 10 }),
    ).toBe('loading');
  });

  // LoadFailed → LoadFailed (before interval)
  it('LoadFailed → LoadFailed on retry before interval', () => {
    expect(
      nextRoomState('load-failed', { type: 'retry', elapsedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }),
    ).toBe('load-failed');
  });

  it('LoadFailed → LoadFailed on retry at 0ms', () => {
    expect(nextRoomState('load-failed', { type: 'retry', elapsedMs: 0 })).toBe('load-failed');
  });

  // Invalid events leave state unchanged
  describe('invalid events leave state unchanged', () => {
    const allStates: RoomState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];
    const allEvents: RoomEvent[] = [
      { type: 'load-success' },
      { type: 'load-failed' },
      { type: 'update-stored' },
      { type: 'compaction-start' },
      { type: 'compaction-success' },
      { type: 'compaction-rollback' },
      { type: 'storage-failed' },
      { type: 'reset' },
      { type: 'hibernate' },
      { type: 'wake' },
      { type: 'retry', elapsedMs: 999_999 },
    ];

    // Define the valid transitions (state|event.type → state changes)
    const validTransitions: Set<string> = new Set([
      'loading|load-success',
      'loading|load-failed',
      'ready|update-stored',
      'ready|compaction-start',
      'ready|storage-failed',
      'ready|hibernate',
      'compacting|compaction-success',
      'compacting|compaction-rollback',
      'storage-failed|reset',
      'hibernated|wake',
      // load-failed|retry is conditional (handled above)
    ]);

    it('all invalid (state, event) pairs leave state unchanged', () => {
      for (const state of allStates) {
        for (const event of allEvents) {
          const key = `${state}|${event.type}`;
          if (validTransitions.has(key)) continue;
          // For load-failed|retry, it's always "valid" (stays or transitions)
          if (state === 'load-failed' && event.type === 'retry') continue;
          expect(nextRoomState(state, event), `${key} should be unchanged`).toBe(state);
        }
      }
    });
  });
});
