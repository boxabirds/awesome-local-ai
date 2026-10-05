/**
 * Unit tests for the room's own lifecycle (TC-27).
 *
 * The room has six places it can be and a dozen ways to move between them, and the
 * difference between a board that recovers and a board that loses somebody's work is
 * almost always which of those moves is allowed. So the table is tested on its own,
 * with no socket, no database and no clock: every edge the design's diagram has, and —
 * the half that matters more — the edges it does not have, which must leave the room
 * exactly where it was.
 *
 * One thing a pure function cannot say: how long a board that failed to load waits
 * before it is tried again. That is `LOAD_RETRY_MIN_INTERVAL_MS`, and what this file
 * can pin down is that `retry` is the *only* way out of `load-failed`, so the wait is
 * enforced by the one caller that ever issues that event (integration TC-16).
 */
import { describe, expect, it } from 'vitest';

import {
  INITIAL_ROOM_LIFECYCLE,
  nextRoomState,
  roomStateOf,
  type RoomEvent,
  type RoomLifecycle,
} from '../../src/worker/room-state';

const LIFECYCLES: RoomLifecycle[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'storage-failed',
  'load-failed',
];

const EVENTS: RoomEvent[] = [
  'wake',
  'loaded',
  'loaded-quarantined',
  'load-failed',
  'compact',
  'compacted',
  'compact-rolled-back',
  'storage-failed',
  'idle',
  'retry',
];

/** Every edge the design's room lifecycle diagram draws. */
const EDGES: [RoomLifecycle, RoomEvent, RoomLifecycle][] = [
  // A board is read back before it is served: the log is the board, and quarantining a
  // row that will not read is a loaded board with a note about it, not a broken one.
  ['loading', 'loaded', 'ready'],
  ['loading', 'loaded-quarantined', 'ready'],
  // A snapshot that cannot be read is the end of reading, for now.
  ['loading', 'load-failed', 'load-failed'],
  // A long log is folded away; a fold that rolled back is not a broken board, because
  // the log it could not fold is still there.
  ['ready', 'compact', 'compacting'],
  ['compacting', 'compacted', 'ready'],
  ['compacting', 'compact-rolled-back', 'ready'],
  // A write that failed is not retried behind people's backs: the room stops serving.
  ['ready', 'storage-failed', 'storage-failed'],
  ['storage-failed', 'wake', 'loading'],
  ['storage-failed', 'retry', 'loading'],
  // An empty board keeps nothing in memory, and reads itself when somebody comes back.
  ['ready', 'idle', 'hibernated'],
  ['hibernated', 'wake', 'loading'],
  // The only way out of a board that could not be read is another try.
  ['load-failed', 'retry', 'loading'],
];

describe('the room lifecycle (TC-27)', () => {
  it('starts by reading itself back', () => {
    expect(INITIAL_ROOM_LIFECYCLE).toBe('loading');
  });

  it('goes wherever the diagram says', () => {
    for (const [from, event, to] of EDGES) {
      expect(nextRoomState(from, event), `${from} -- ${event} -->`).toBe(to);
    }
  });

  it('stays where it is for an event that is not this state\'s business', () => {
    const allowed = new Set(EDGES.map(([from, event]) => `${from} ${event}`));
    const unexpected: string[] = [];
    for (const state of LIFECYCLES) {
      for (const event of EVENTS) {
        if (allowed.has(`${state} ${event}`)) continue;
        if (nextRoomState(state, event) !== state) unexpected.push(`${state} -- ${event} --> ${nextRoomState(state, event)}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it('does not serve a board it has not read yet', () => {
    // A room that is loading has no document to answer with, and a room that is
    // compacting is between two writes. Neither is a state to accept a change in.
    expect(roomStateOf('loading')).toBe('ready');
    expect(roomStateOf('compacting')).toBe('ready');
    expect(roomStateOf('ready')).toBe('ready');
    expect(roomStateOf('hibernated')).toBe('ready');
    expect(roomStateOf('load-failed')).toBe('load-failed');
    expect(roomStateOf('storage-failed')).toBe('storage-failed');
  });

  it('has exactly one way out of a board that could not be read', () => {
    // Everything except a fresh attempt leaves it alone: no event a message or a
    // compaction could raise is allowed to turn "this board could not be loaded" into
    // "this board is empty", which is the failure this whole story is guarding against.
    for (const event of EVENTS) {
      const next = nextRoomState('load-failed', event);
      expect(next, `load-failed -- ${event} -->`).toBe(event === 'retry' ? 'loading' : 'load-failed');
    }
  });

  it('has exactly one way out of a board it could not write', () => {
    for (const event of EVENTS) {
      const next = nextRoomState('storage-failed', event);
      // A board that could not be written is read back by the next connection, which is the only
      // one that holds what the failed write lost. Nothing else moves it.
      expect(next, `storage-failed -- ${event} -->`).toBe(event === 'retry' || event === 'wake' ? 'loading' : 'storage-failed');
    }
  });

  it('does not fold a log away twice, or read a board it has read', () => {
    expect(nextRoomState('compacting', 'compact')).toBe('compacting');
    expect(nextRoomState('ready', 'loaded')).toBe('ready');
    expect(nextRoomState('ready', 'wake')).toBe('ready');
    expect(nextRoomState('hibernated', 'idle')).toBe('hibernated');
  });

  it('gives a board that cannot be written no way back except a new connection', () => {
    // Not an alarm, not a compaction, not the last socket leaving: the people still
    // holding this board have changes that never landed, and the room that comes back
    // has to be the one they reconnect to.
    expect(nextRoomState('storage-failed', 'idle')).toBe('storage-failed');
    expect(nextRoomState('storage-failed', 'compact')).toBe('storage-failed');
    expect(nextRoomState('storage-failed', 'loaded')).toBe('storage-failed');
  });
});
