/**
 * Unit: the room's lifecycle (TC-27).
 *
 * The room itself is only tested through sockets elsewhere; this suite is the
 * whole point of having a state machine at all — every edge of the design's
 * diagram is one assertion, and every state/event pair that is *not* an edge is
 * asserted to change nothing, so a message arriving out of order can never put
 * the room somewhere the design did not draw.
 */

import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  nextRoomState,
  shouldRetryLoad,
  ROOM_EVENT_TYPES,
  type RoomEvent,
  type RoomLifecycleState
} from '../../src/worker/room-state';

const STATES: RoomLifecycleState[] = ['loading', 'ready', 'compacting', 'storage-failed', 'hibernated', 'load-failed'];

/** A `reopen` late enough to be worth trying again. */
const lateReopen: RoomEvent = { type: 'reopen', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS * 3 };

/** Every event, so "no edge" can be proven by exhaustion rather than by hope. */
const EVENTS: RoomEvent[] = ROOM_EVENT_TYPES.map((type) =>
  type === 'reopen' ? lateReopen : ({ type } as RoomEvent)
);

/** The drawn edges: [from, event, to]. */
const edges: [RoomLifecycleState, RoomEvent, RoomLifecycleState][] = [
  // A board that reads is servable — with a row quarantined or not, both are Ready.
  ['loading', { type: 'loaded' }, 'ready'],
  // An unreadable snapshot or a failing SQL read is a failure, not an empty board.
  ['loading', { type: 'load-failed' }, 'load-failed'],
  // The log passes its threshold, and both ways it ends back in Ready.
  ['ready', { type: 'compact' }, 'compacting'],
  ['compacting', { type: 'compacted' }, 'ready'],
  ['compacting', { type: 'compact-rolled-back' }, 'ready'],
  // An update is applied, stored and broadcast: still Ready.
  ['ready', { type: 'update' }, 'ready'],
  // A write fails: the room throws its document away and a new connection reloads.
  ['ready', { type: 'storage-error' }, 'storage-failed'],
  ['storage-failed', { type: 'reconnect' }, 'loading'],
  // Idle: the object may be evicted, and a message or connection reloads it.
  ['ready', { type: 'hibernate' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  // A board that failed to load retries, but only after the interval.
  ['load-failed', lateReopen, 'loading'],
  ['load-failed', { type: 'reopen', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
  ['load-failed', { type: 'reopen', sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'load-failed']
];

describe('the room lifecycle edges', () => {
  // TC-27
  it('takes every drawn edge, including the quarantine and rollback paths', () => {
    for (const [from, event, to] of edges) {
      expect(nextRoomState(from, event), `${from} + ${event.type} → ${to}`).toBe(to);
    }
  });

  it('knows the load-retry interval as its boundary', () => {
    expect(shouldRetryLoad(LOAD_RETRY_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRetryLoad(LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldRetryLoad(0)).toBe(false);
  });

  // TC-27 (negative): everything not drawn leaves the state where it was.
  it('ignores every event that has no edge out of the current state', () => {
    const drawn = new Set(edges.map(([from, event]) => `${from}|${event.type}|${nextRoomState(from, event)}`));
    for (const state of STATES) {
      for (const event of EVENTS) {
        const next = nextRoomState(state, event);
        const isEdge = drawn.has(`${state}|${event.type}|${next}`);
        if (!isEdge) {
          expect(next, `${state} + ${event.type} should change nothing`).toBe(state);
        }
      }
    }
  });

  it('never reaches a state the diagram has no arrow into', () => {
    // `load-failed` is only ever entered by a load, `storage-failed` only by a
    // failed write: nobody skips straight there from a live room.
    expect(nextRoomState('ready', { type: 'load-failed' })).toBe('ready');
    expect(nextRoomState('hibernated', { type: 'storage-error' })).toBe('hibernated');
    expect(nextRoomState('load-failed', { type: 'storage-error' })).toBe('load-failed');
    expect(nextRoomState('storage-failed', { type: 'update' })).toBe('storage-failed');
    expect(nextRoomState('compacting', { type: 'storage-error' })).toBe('compacting');
    // A room that has already failed to load does not retry because a socket
    // arrived: only the passage of time reopens it.
    expect(nextRoomState('load-failed', { type: 'wake' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'reconnect' })).toBe('load-failed');
  });

  it('is total: every state answers every event', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        expect(STATES).toContain(nextRoomState(state, event));
      }
    }
  });
});
