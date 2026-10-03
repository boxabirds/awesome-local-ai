// persist.room — the room lifecycle as a pure function (TC-27).
//
// Every edge of the design's room state diagram is asserted, and every event
// that is NOT an edge for a state must leave that state unchanged (the room must
// never move to a nonsense state because an event arrived late or out of order).

import { describe, expect, it } from 'vitest';
import {
  nextRoomState,
  type RoomEvent,
  type RoomLifecycleState,
} from '../../src/worker/room-state';

const ALL_STATES: RoomLifecycleState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

const ALL_EVENTS: RoomEvent[] = [
  'load-ok',
  'load-quarantined',
  'load-error',
  'update-stored',
  'compact-start',
  'compact-done',
  'compact-rollback',
  'storage-error',
  'reload',
  'hibernate',
  'wake',
  'retry-allowed',
  'retry-refused',
];

/** The edges drawn in the design's lifecycle diagram. */
const EDGES: Array<[RoomLifecycleState, RoomEvent, RoomLifecycleState]> = [
  // [*] --> Loading : object constructed or woken  (loading is the entry state)
  ['loading', 'load-ok', 'ready'],
  ['loading', 'load-quarantined', 'ready'],
  ['loading', 'load-error', 'load-failed'],
  // Ready --> Ready : update applied, stored, broadcast
  ['ready', 'update-stored', 'ready'],
  // Ready --> Compacting --> Ready
  ['ready', 'compact-start', 'compacting'],
  ['compacting', 'compact-done', 'ready'],
  // Compacting --> Ready : compaction error rolled back, log intact
  ['compacting', 'compact-rollback', 'ready'],
  // Ready --> StorageFailed --> Loading (next connection)
  ['ready', 'storage-error', 'storage-failed'],
  ['storage-failed', 'reload', 'loading'],
  // Ready --> Hibernated --> Loading (message or new connection wakes object)
  ['ready', 'hibernate', 'hibernated'],
  ['hibernated', 'wake', 'loading'],
  // LoadFailed --> Loading : new connection after LOAD_RETRY_MIN_INTERVAL_MS
  ['load-failed', 'retry-allowed', 'loading'],
  // LoadFailed --> LoadFailed : connection before the interval, closed 4500
  ['load-failed', 'retry-refused', 'load-failed'],
];

describe('nextRoomState covers every edge of the lifecycle diagram (TC-27)', () => {
  for (const [from, event, to] of EDGES) {
    it(`${from} --${event}--> ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('covers every state as a source of at least one edge', () => {
    const sources = new Set(EDGES.map(([from]) => from));
    // `loading` is reached by wake/reload and leaves by a load outcome; every
    // state must appear somewhere in the edge set.
    for (const state of ALL_STATES) {
      expect(sources.has(state) || state === 'loading').toBe(true);
    }
  });
});

describe('nextRoomState leaves state unchanged on every invalid event (TC-27)', () => {
  const valid = new Set(EDGES.map(([from, event]) => `${from}:${event}`));

  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (valid.has(`${state}:${event}`)) continue;
      it(`leaves ${state} unchanged on ${event}`, () => {
        expect(nextRoomState(state, event)).toBe(state);
      });
    }
  }
});
