/**
 * persist.room, unit: the room lifecycle as a pure function (TC-27).
 *
 * Every edge of the design's state diagram is checked, plus the negative half of
 * the contract: an event with no edge out of a state leaves that state alone, so
 * a room cannot be pushed into a state it has no path to (a serving room never
 * becomes `load-failed`, a room that could not load never starts serving, and a
 * board that failed to load retries only after LOAD_RETRY_MIN_INTERVAL_MS).
 */

import { describe, expect, it } from 'vitest';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  loadRetryAllowed,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

const ALL_STATES: readonly RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

/** A connection attempt `elapsed` ms after the last load attempt. */
function connection(elapsed: number): RoomEvent {
  return { type: 'connection', now: 1_000 + elapsed, lastLoadAttemptAt: 1_000 };
}

describe('nextRoomState: the edges of the lifecycle diagram (TC-27)', () => {
  it('construct/wake starts in loading and a successful load makes it ready', () => {
    // [*] -> loading is the state the constructor starts in, modelled as the
    // starting point of every load path below.
    expect(nextRoomState('loading', { type: 'loaded' })).toBe('ready');
  });

  it('quarantining a damaged log row still ends ready (persist.partial_damage)', () => {
    // The quarantined count is a load *outcome*, not part of the state: the
    // diagram has one Ready edge for "applied" and "quarantined, rest applied".
    expect(nextRoomState('loading', { type: 'loaded' })).toBe('ready');
  });

  it('an unreadable snapshot or a SQL error makes it load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('an update in ready is stored and broadcast and leaves the room ready', () => {
    expect(nextRoomState('ready', { type: 'update' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'message' })).toBe('ready');
  });

  it('a long log compacts and comes back to ready — success or rollback', () => {
    expect(nextRoomState('ready', { type: 'compact' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'compacted' })).toBe('ready');
  });

  it('a failed write resets the room, and the next connection reloads it', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
    // No retry interval here: the interval belongs to `load-failed` alone, and a
    // room that lost its document to a write failure reloads on the next dial.
    expect(nextRoomState('storage-failed', connection(0))).toBe('loading');
    expect(nextRoomState('storage-failed', { type: 'reload' })).toBe('loading');
  });

  it('no events hibernates the object; traffic wakes it and loads again', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    expect(nextRoomState('hibernated', { type: 'message' })).toBe('loading');
    expect(nextRoomState('hibernated', connection(0))).toBe('loading');
  });

  it('a load-failed room reloads only on a connection after the retry interval', () => {
    expect(nextRoomState('load-failed', connection(LOAD_RETRY_MIN_INTERVAL_MS - 1))).toBe(
      'load-failed',
    );
    expect(nextRoomState('load-failed', connection(LOAD_RETRY_MIN_INTERVAL_MS))).toBe('loading');
    expect(nextRoomState('load-failed', connection(LOAD_RETRY_MIN_INTERVAL_MS + 60_000))).toBe(
      'loading',
    );
  });

  it('reports whether a retry is allowed at the same boundary', () => {
    expect(loadRetryAllowed(1_000, 1_000 + LOAD_RETRY_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(loadRetryAllowed(1_000, 1_000 + LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
  });
});

describe('nextRoomState: events with no edge leave the state alone (TC-27 negative)', () => {
  it('keeps a serving room serving: it never becomes load-failed', () => {
    expect(nextRoomState('ready', { type: 'load-failed' })).toBe('ready');
  });

  it('keeps a load-failed room load-failed: no load result, message or reload rescues it', () => {
    // Only the gated connection edge leads out, so the room cannot be talked into
    // serving a document it never read.
    expect(nextRoomState('load-failed', { type: 'loaded' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'load-failed' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'message' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'update' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'compact' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'compacted' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'storage-error' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'reload' })).toBe('load-failed');
  });

  it('keeps a loading room loading: loading blocks everything else', () => {
    for (const event of [
      { type: 'update' },
      { type: 'compact' },
      { type: 'compacted' },
      { type: 'storage-error' },
      { type: 'hibernate' },
      { type: 'reload' },
    ] satisfies RoomEvent[]) {
      expect(nextRoomState('loading', event)).toBe('loading');
    }
  });

  it('keeps a compacting room compacting until compaction reports back', () => {
    // Compaction swallows its own errors (rollback + false), so a write failure
    // cannot take a serving room down from inside the compaction transaction.
    expect(nextRoomState('compacting', { type: 'storage-error' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'load-failed' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'update' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'hibernate' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'compact' })).toBe('compacting');
  });

  it('keeps a storage-failed room down until a connection or reload reloads it', () => {
    for (const event of [
      { type: 'loaded' },
      { type: 'load-failed' },
      { type: 'update' },
      { type: 'message' },
      { type: 'compact' },
      { type: 'compacted' },
      { type: 'storage-error' },
      { type: 'hibernate' },
    ] satisfies RoomEvent[]) {
      expect(nextRoomState('storage-failed', event)).toBe('storage-failed');
    }
  });

  it('a hibernated room only comes back through a message or a connection', () => {
    for (const event of [
      { type: 'loaded' },
      { type: 'load-failed' },
      { type: 'update' },
      { type: 'compact' },
      { type: 'compacted' },
      { type: 'storage-error' },
      { type: 'hibernate' },
    ] satisfies RoomEvent[]) {
      expect(nextRoomState('hibernated', event)).toBe('hibernated');
    }
  });

  it('never invents a state', () => {
    const events: RoomEvent[] = [
      { type: 'loaded' },
      { type: 'load-failed' },
      { type: 'update' },
      { type: 'message' },
      { type: 'compact' },
      { type: 'compacted' },
      { type: 'storage-error' },
      { type: 'reload' },
      { type: 'hibernate' },
      connection(0),
      connection(LOAD_RETRY_MIN_INTERVAL_MS * 2),
    ];
    for (const state of ALL_STATES) {
      for (const event of events) {
        expect(ALL_STATES).toContain(nextRoomState(state, event));
      }
    }
  });
});
