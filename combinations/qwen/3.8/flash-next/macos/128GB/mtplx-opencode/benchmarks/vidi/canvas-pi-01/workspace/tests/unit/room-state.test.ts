/**
 * Story 4 · unit test for the room state machine (TC-27).
 *
 * Covers every edge of the design's room lifecycle diagram, plus negative
 * cases: events a state does not define leave it unchanged. The load-retry
 * interval is expressed as the `retry-load` / `retry-load-early` pair, so no
 * test waits on a clock (design "No time-coupled asserts").
 */
import { describe, expect, it } from 'vitest';
import {
  closeCodeForState,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

/** Events the diagram does not define for the state on their left. */
const unchangedPairs: ReadonlyArray<readonly [RoomState, RoomEvent]> = [
  ['ready', 'load-success'],
  ['ready', 'load-failed'],
  ['ready', 'retry-load'],
  ['ready', 'retry-load-early'],
  ['ready', 'load-quarantined'],
  ['ready', 'wake'],
  ['load-failed', 'storage-error'],
  ['load-failed', 'wake'],
  ['load-failed', 'update'],
  ['load-failed', 'idle'],
  ['storage-failed', 'retry-load'],
  ['storage-failed', 'update'],
  ['storage-failed', 'storage-error'],
  ['storage-failed', 'idle'],
  ['loading', 'update'],
  ['loading', 'storage-error'],
  ['loading', 'compact-start'],
  ['compacting', 'update'],
  ['compacting', 'storage-error'],
  ['hibernated', 'retry-load'],
  ['hibernated', 'load-success'],
];

describe('nextRoomState (TC-27)', () => {
  // --- Every edge of the diagram -----------------------------------------
  it('[*] → Loading on construct or wake', () => {
    // A freshly constructed / woken room starts unloaded.
    expect(nextRoomState('hibernated', 'wake')).toBe('loading');
    expect(nextRoomState('storage-failed', 'wake')).toBe('loading');
  });

  it('Loading → Ready when the snapshot and log applied', () => {
    expect(nextRoomState('loading', 'load-success')).toBe('ready');
  });

  it('Loading → Ready when quarantined rows were skipped', () => {
    expect(nextRoomState('loading', 'load-quarantined')).toBe('ready');
  });

  it('Loading → LoadFailed when the snapshot is unreadable or SQL errors', () => {
    expect(nextRoomState('loading', 'load-failed')).toBe('load-failed');
  });

  it('Ready → Ready while updates are applied, stored and broadcast', () => {
    expect(nextRoomState('ready', 'update')).toBe('ready');
  });

  it('Ready → Compacting → Ready when the log exceeds a threshold', () => {
    expect(nextRoomState('ready', 'compact-start')).toBe('compacting');
    expect(nextRoomState('compacting', 'compact-done')).toBe('ready');
  });

  it('Ready → Compacting → Ready when compaction failed and rolled back', () => {
    expect(nextRoomState('ready', 'compact-start')).toBe('compacting');
    expect(nextRoomState('compacting', 'compact-error')).toBe('ready');
  });

  it('Ready → StorageFailed when an insert throws', () => {
    expect(nextRoomState('ready', 'storage-error')).toBe('storage-failed');
  });

  it('StorageFailed → Loading on the next connection (doc discarded)', () => {
    expect(nextRoomState('storage-failed', 'wake')).toBe('loading');
    // …and that reload can fail too (a board does not resurrect itself).
    expect(nextRoomState('loading', 'load-failed')).toBe('load-failed');
  });

  it('Ready → Hibernated when idle, with sockets possibly still open', () => {
    expect(nextRoomState('ready', 'idle')).toBe('hibernated');
  });

  it('Hibernated → Loading on a message or a new connection', () => {
    expect(nextRoomState('hibernated', 'wake')).toBe('loading');
    expect(nextRoomState('hibernated', 'update')).toBe('hibernated'); // negative
  });

  it('LoadFailed → Loading only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    expect(nextRoomState('load-failed', 'retry-load')).toBe('loading');
  });

  it('LoadFailed before the interval stays LoadFailed and closes 4500', () => {
    expect(nextRoomState('load-failed', 'retry-load-early')).toBe('load-failed');
    expect(closeCodeForState('load-failed')).toBe(4500);
  });

  // --- Negative: undefined events leave the state unchanged ---------------
  it.each(unchangedPairs)('%s ignores %s', (state, event) => {
    expect(nextRoomState(state, event)).toBe(state);
  });

  it('a state that cannot serve a client reports the design close code', () => {
    expect(closeCodeForState('storage-failed')).toBe(1011);
    expect(closeCodeForState('ready')).toBeNull();
    expect(closeCodeForState('loading')).toBeNull();
    expect(closeCodeForState('compacting')).toBeNull();
    expect(closeCodeForState('hibernated')).toBeNull();
  });
});
