/**
 * The room's lifecycle, as the design's state diagram says it, tested as the pure
 * function it is.
 *
 * TC-27 has two halves. Every edge of the diagram must be taken exactly as drawn,
 * and every event that the diagram does *not* draw for a state must leave that
 * state alone — a room that answers a stray event by, say, discarding its document
 * would lose the board for everybody on it. Because "everything else" is a large
 * set, the negative half is exhaustive: the test walks the cross product of states
 * and events and compares against the edge list, so a new edge has to be written
 * down here before the code is allowed to take it.
 */
import { describe, expect, it } from 'vitest';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

const STATES: RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'storage-failed',
  'load-failed',
];

/** One event of each kind, with the values the edges are drawn for. */
const EVENTS: RoomEvent[] = [
  { type: 'loaded', quarantined: 0 },
  { type: 'load-failed' },
  { type: 'update-stored' },
  { type: 'compaction-started' },
  { type: 'compaction-committed' },
  { type: 'compaction-rolled-back' },
  { type: 'storage-error' },
  { type: 'hibernated' },
  { type: 'woken' },
  { type: 'retry-load', msSinceLastAttempt: LOAD_RETRY_MIN_INTERVAL_MS },
];

function key(state: RoomState, event: RoomEvent): string {
  return `${state} + ${event.type}`;
}

/** The edges of the design's lifecycle diagram, in the order it draws them. */
const EDGES: Record<string, RoomState> = {
  // Loading -> Ready: the snapshot and the log applied.
  'loading + loaded': 'ready',
  // Loading -> LoadFailed: the snapshot is unreadable, or SQL itself failed.
  'loading + load-failed': 'load-failed',
  // Ready -> Ready: an update was applied, stored and broadcast.
  'ready + update-stored': 'ready',
  // Ready -> Compacting: the log passed its threshold.
  'ready + compaction-started': 'compacting',
  // Compacting -> Ready: snapshot replaced, log truncated…
  'compacting + compaction-committed': 'ready',
  // …and equally when the compaction was rolled back with the log intact.
  'compacting + compaction-rolled-back': 'ready',
  // Ready -> StorageFailed: an insert threw.
  'ready + storage-error': 'storage-failed',
  // StorageFailed -> Loading: the next connection reloads the document.
  'storage-failed + woken': 'loading',
  // Ready -> Hibernated: nothing to do, sockets may stay open.
  'ready + hibernated': 'hibernated',
  // Hibernated -> Loading: a message or a new connection wakes the object.
  'hibernated + woken': 'loading',
  // LoadFailed -> Loading: a new connection after LOAD_RETRY_MIN_INTERVAL_MS.
  'load-failed + retry-load': 'loading',
};

describe('nextRoomState (TC-27)', () => {
  it('takes every edge of the room lifecycle diagram', () => {
    for (const [edge, expected] of Object.entries(EDGES)) {
      const [state, eventType] = edge.split(' + ') as [RoomState, string];
      const event = EVENTS.find((candidate) => candidate.type === eventType);
      expect(event, `no such event in the table: ${eventType}`).toBeDefined();
      expect(nextRoomState(state, event!), edge).toBe(expected);
    }
  });

  it('leaves every event the diagram does not draw for a state unchanged', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        const expected = EDGES[key(state, event)] ?? state;
        expect(nextRoomState(state, event), key(state, event)).toBe(expected);
      }
    }
  });

  it('reports a load that quarantined damaged rows as ready', () => {
    // The board opened with everything it could read; one bad row is a detail.
    expect(nextRoomState('loading', { type: 'loaded', quarantined: 3 })).toBe('ready');
  });

  it('retries a failed load only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
    const boundary: [number, RoomState][] = [
      [LOAD_RETRY_MIN_INTERVAL_MS - 1, 'load-failed'],
      [LOAD_RETRY_MIN_INTERVAL_MS, 'loading'],
      [LOAD_RETRY_MIN_INTERVAL_MS + 1, 'loading'],
    ];
    for (const [elapsed, expected] of boundary) {
      expect(nextRoomState('load-failed', { type: 'retry-load', msSinceLastAttempt: elapsed })).toBe(
        expected,
      );
    }
  });

  it('never leaves load-failed for a ready room by accident', () => {
    // The three states a room can be watched in are ready, load-failed and
    // storage-failed; nothing but a real load moves it into `ready`.
    for (const event of EVENTS) {
      if (event.type === 'loaded') continue;
      expect(nextRoomState('load-failed', event), event.type).toBe('load-failed');
    }
    for (const event of EVENTS) {
      if (event.type === 'loaded' || event.type === 'woken') continue;
      expect(nextRoomState('loading', event), event.type).toBe('loading');
    }
  });
});
