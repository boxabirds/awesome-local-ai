/**
 * The room's life, edge by edge (TC-27).
 *
 * Everything interesting about story 4 is a question about which state the room is in: may
 * this connection be served the board, or must it be refused; is the document still ours to
 * broadcast from; is it worth reading the storage again yet. `nextRoomState` answers those
 * questions in one table, so the table can be checked against the diagram in the design
 * without a Durable Object, a database, or a clock.
 */

import { describe, expect, it } from 'vitest';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  ROOM_EVENTS,
  ROOM_STATES,
  isRoomEventHandled,
  loadRetryEvent,
  nextRoomState,
  shouldRetryLoad,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

/** Every edge of the design's room lifecycle diagram, as (from, event, to). */
const EDGES: readonly [RoomState, RoomEvent, RoomState][] = [
  // Loaded, or refused: the three ways a read of storage can end.
  ['loading', 'load-ok', 'ready'],
  ['loading', 'load-quarantined', 'ready'],
  ['loading', 'load-error', 'load-failed'],
  // Working: a change is stored and then shown; a long log gets folded up and comes back.
  ['ready', 'update-applied', 'ready'],
  ['ready', 'compact-needed', 'compacting'],
  ['compacting', 'compact-ok', 'ready'],
  // A compaction that failed has not happened: the log is intact and the board is open.
  ['compacting', 'compact-error', 'ready'],
  // A change that could not be written down stops the board being shown as saved.
  ['ready', 'append-error', 'storage-failed'],
  ['storage-failed', 'reconnect', 'loading'],
  // Nothing to hold in memory for; the next thing that arrives reads it back.
  ['ready', 'idle', 'hibernated'],
  ['hibernated', 'wake', 'loading'],
  // A board that could not be read is retried on a connection, and only after a while.
  ['load-failed', 'retry-load', 'loading'],
  ['load-failed', 'reject-load', 'load-failed'],
];

describe('every edge of the room lifecycle', () => {
  it('leads where the diagram says', () => {
    for (const [from, event, to] of EDGES) {
      expect(nextRoomState(from, event), `${from} --${event}--> ${to}`).toBe(to);
    }
  });

  it('names every state and event the table can be asked about', () => {
    // A new state or event in the table that this test has not been told about shows up here.
    expect(ROOM_STATES).toEqual([
      'loading',
      'ready',
      'compacting',
      'storage-failed',
      'hibernated',
      'load-failed',
    ]);
    expect(ROOM_EVENTS).toEqual([
      'load-ok',
      'load-quarantined',
      'load-error',
      'update-applied',
      'compact-needed',
      'compact-ok',
      'compact-error',
      'append-error',
      'reconnect',
      'idle',
      'wake',
      'retry-load',
      'reject-load',
    ]);
  });

  it('holds for every edge the diagram has, and the diagram has every edge the table has', () => {
    const diagram = new Map(EDGES.map(([from, event, to]) => [`${from}:${event}`, to]));
    for (const state of ROOM_STATES) {
      for (const event of ROOM_EVENTS) {
        const key = `${state}:${event}`;
        if (isRoomEventHandled(state, event)) {
          // A new edge in the table is a change to the lifecycle, so it belongs in the
          // diagram in the design — and this test says so before the room does.
          expect(diagram.has(key), `${key} is not in the lifecycle diagram`).toBe(true);
          expect(nextRoomState(state, event), `${key} does not go where the diagram says`).toBe(
            diagram.get(key),
          );
        } else {
          expect(diagram.has(key), `${key} is in the diagram but not in the table`).toBe(false);
        }
      }
    }
  });
});

describe('an event that means nothing here changes nothing', () => {
  it('leaves the state where it was, for every state and event that has no edge', () => {
    for (const state of ROOM_STATES) {
      for (const event of ROOM_EVENTS) {
        if (isRoomEventHandled(state, event)) continue;
        expect(nextRoomState(state, event), `${state} --${event}--> should have been ignored`).toBe(
          state,
        );
      }
    }
  });

  it('gives a real state for every pair, so a caller never has to handle undefined', () => {
    for (const state of ROOM_STATES) {
      for (const event of ROOM_EVENTS) {
        expect(ROOM_STATES, `${state} --${event}-->`).toContain(nextRoomState(state, event));
      }
    }
  });

  it('does not let a board that is open be told it failed to load', () => {
    // The room cannot be handed a load result after the fact; if it could, a late answer
    // would take a working board away from the people on it.
    expect(nextRoomState('ready', 'load-error')).toBe('ready');
    expect(nextRoomState('storage-failed', 'append-error')).toBe('storage-failed');
    expect(nextRoomState('load-failed', 'append-error')).toBe('load-failed');
  });

  it('does not wake a board that is already being served, or fold a log that is not open', () => {
    expect(nextRoomState('loading', 'wake')).toBe('loading');
    expect(nextRoomState('load-failed', 'wake')).toBe('load-failed');
    expect(nextRoomState('loading', 'compact-needed')).toBe('loading');
    expect(nextRoomState('storage-failed', 'update-applied')).toBe('storage-failed');
    expect(nextRoomState('load-failed', 'update-applied')).toBe('load-failed');
    expect(nextRoomState('hibernated', 'idle')).toBe('hibernated');
  });

  it('only refuses a connection or retries it once, from the state that refuses them', () => {
    expect(nextRoomState('ready', 'reject-load')).toBe('ready');
    expect(nextRoomState('loading', 'retry-load')).toBe('loading');
    expect(nextRoomState('hibernated', 'retry-load')).toBe('hibernated');
  });
});

describe('a board that could not be read is retried on a schedule (the boundary)', () => {
  const failedAt = 1_700_000_000_000;

  it('not one moment before the interval has gone by', () => {
    expect(shouldRetryLoad(failedAt + LOAD_RETRY_MIN_INTERVAL_MS - 1, failedAt)).toBe(false);
    expect(loadRetryEvent(failedAt + LOAD_RETRY_MIN_INTERVAL_MS - 1, failedAt)).toBe('reject-load');
    // …and the room stays where it is, which is what makes the next connection a refusal too.
    expect(nextRoomState('load-failed', 'reject-load')).toBe('load-failed');
  });

  it('exactly on it', () => {
    expect(shouldRetryLoad(failedAt + LOAD_RETRY_MIN_INTERVAL_MS, failedAt)).toBe(true);
    expect(loadRetryEvent(failedAt + LOAD_RETRY_MIN_INTERVAL_MS, failedAt)).toBe('retry-load');
    expect(nextRoomState('load-failed', 'retry-load')).toBe('loading');
  });

  it('long after it', () => {
    expect(shouldRetryLoad(failedAt + LOAD_RETRY_MIN_INTERVAL_MS * 100, failedAt)).toBe(true);
  });

  it('at the interval the room was given, which is how a test crosses the boundary in a second', () => {
    expect(shouldRetryLoad(1_000, 0, 2_000)).toBe(false);
    expect(shouldRetryLoad(2_000, 0, 2_000)).toBe(true);
    expect(loadRetryEvent(1_999, 0, 2_000)).toBe('reject-load');
    expect(loadRetryEvent(2_000, 0, 2_000)).toBe('retry-load');
  });

  it('the interval the product is configured with is the one the room would use', () => {
    // Not a test of arithmetic: a guard on the number itself, because a retry interval of a
    // minute would make "come back tomorrow" depend on a browser tab being open.
    expect(LOAD_RETRY_MIN_INTERVAL_MS).toBe(5_000);
  });
});
