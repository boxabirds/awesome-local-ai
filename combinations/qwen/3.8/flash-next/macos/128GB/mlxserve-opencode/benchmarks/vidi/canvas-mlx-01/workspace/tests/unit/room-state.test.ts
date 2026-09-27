/**
 * Unit tests for the pure `BoardRoom` lifecycle model (`persist.room`, TC-27): every
 * edge of the design's room state diagram, plus the negative case that an invalid
 * event for a state leaves it unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  nextRoomState,
  type RoomLifecycleEvent,
  type RoomLifecycleState,
} from '../../src/worker/room-state.js';

const ALL_STATES: RoomLifecycleState[] = [
  'loading',
  'ready',
  'load-failed',
  'compacting',
  'storage-failed',
  'hibernated',
];

const ALL_EVENTS: RoomLifecycleEvent[] = [
  'load-applied',
  'load-applied-quarantined',
  'load-failed',
  'compact',
  'compact-success',
  'compact-failure',
  'storage-error',
  'storage-recovered',
  'idle',
  'wake',
  'open',
];

describe('nextRoomState lifecycle edges (TC-27)', () => {
  it('Loading -> Ready on a clean load', () => {
    expect(nextRoomState('loading', 'load-applied')).toBe('ready');
  });

  it('Loading -> Ready when damaged log rows were quarantined', () => {
    expect(nextRoomState('loading', 'load-applied-quarantined')).toBe('ready');
  });

  it('Loading -> LoadFailed on an unreadable snapshot / SQL read error', () => {
    expect(nextRoomState('loading', 'load-failed')).toBe('load-failed');
  });

  it('Ready -> Compacting -> Ready on a successful compaction', () => {
    const mid = nextRoomState('ready', 'compact');
    expect(mid).toBe('compacting');
    expect(nextRoomState(mid, 'compact-success')).toBe('ready');
  });

  it('Compacting -> Ready with the log intact after a rolled-back compaction', () => {
    expect(nextRoomState('compacting', 'compact-failure')).toBe('ready');
  });

  it('Ready -> StorageFailed when an insert throws', () => {
    expect(nextRoomState('ready', 'storage-error')).toBe('storage-failed');
  });

  it('StorageFailed -> Loading on the next connection / wake', () => {
    expect(nextRoomState('storage-failed', 'open')).toBe('loading');
    expect(nextRoomState('storage-failed', 'wake')).toBe('loading');
    expect(nextRoomState('storage-failed', 'storage-recovered')).toBe('loading');
  });

  it('Ready -> Hibernated when there are no events', () => {
    expect(nextRoomState('ready', 'idle')).toBe('hibernated');
  });

  it('Hibernated -> Loading when a message or connection wakes the object', () => {
    expect(nextRoomState('hibernated', 'wake')).toBe('loading');
    expect(nextRoomState('hibernated', 'open')).toBe('loading');
  });

  it('LoadFailed -> Loading only on a retry-eligible event (after the interval)', () => {
    expect(nextRoomState('load-failed', 'open')).toBe('loading');
    expect(nextRoomState('load-failed', 'wake')).toBe('loading');
  });

  it('an event that is not a retry leaves LoadFailed unchanged (closed 4500 early)', () => {
    // The caller only emits `open`/`wake` after LOAD_RETRY_MIN_INTERVAL_MS; before then
    // it closes the socket with 4500 and emits nothing that would leave LoadFailed.
    expect(nextRoomState('load-failed', 'compact')).toBe('load-failed');
    expect(nextRoomState('load-failed', 'load-applied')).toBe('load-failed');
  });
});

describe('nextRoomState negatives (TC-27)', () => {
  it('an event undefined for a state leaves it unchanged', () => {
    // Ready is unchanged by load/open/compact-success style events it is not expecting.
    expect(nextRoomState('ready', 'load-applied')).toBe('ready');
    expect(nextRoomState('ready', 'compact-success')).toBe('ready');
    expect(nextRoomState('ready', 'wake')).toBe('ready');
    expect(nextRoomState('ready', 'open')).toBe('ready');
    // Loading ignores operational events until it resolves.
    expect(nextRoomState('loading', 'compact')).toBe('loading');
    expect(nextRoomState('loading', 'storage-error')).toBe('loading');
    expect(nextRoomState('loading', 'idle')).toBe('loading');
  });

  it('never throws and always returns a known state', () => {
    for (const s of ALL_STATES) {
      for (const e of ALL_EVENTS) {
        expect(ALL_STATES).toContain(nextRoomState(s, e));
      }
    }
  });
});
