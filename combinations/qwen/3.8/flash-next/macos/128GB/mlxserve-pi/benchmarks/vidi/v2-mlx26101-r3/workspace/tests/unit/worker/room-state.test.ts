/**
 * TC-27: every edge of the room's lifecycle diagram, and the events a state must ignore.
 *
 * The diagram this file walks is the one in the story 4 design: a room loads when it is
 * constructed or woken, serves once the saved board is in, folds its log up when the log gets
 * long, goes dormant with nobody connected, and has two failure states a person can notice -
 * a board that will not load, and a board that cannot be written to. Both of them are about
 * what happens *next*, so the transitions are worth pinning down on their own: the room is a
 * Durable Object and cannot be asked "what would you do with this event" the way this
 * function can.
 */

import { describe, expect, it } from 'vitest';
import {
  nextRoomState,
  type LifecycleState,
  type RoomEvent,
} from '../../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../../src/shared/config';

/** The lifecycle states a room passes through, in the order the diagram meets them. */
const STATES: LifecycleState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'storage-failed',
  'load-failed',
];

/** Every event the room can be told about, with the interval already elapsed. */
const EVENTS: RoomEvent[] = [
  { type: 'wake' },
  { type: 'load-ok' },
  { type: 'load-error' },
  { type: 'update' },
  { type: 'compact' },
  { type: 'compact-ok' },
  { type: 'compact-error' },
  { type: 'storage-error' },
  { type: 'hibernate' },
  { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS },
];

/** The events one state answers, and what it answers them with. */
const EDGES: Record<LifecycleState, Partial<Record<RoomEvent['type'], LifecycleState>>> = {
  // Constructed or woken: the saved board is read. Either it comes in, or it does not.
  loading: {
    'load-ok': 'ready',
    'load-error': 'load-failed',
  },
  // Serving. An edit is applied, stored and passed on; a long log is folded; a write that
  // fails takes the room out of service; nothing to do means it may go dormant.
  ready: {
    update: 'ready',
    compact: 'compacting',
    'storage-error': 'storage-failed',
    hibernate: 'hibernated',
    connection: 'ready',
  },
  // Folding the log up. Both outcomes end with the room serving again: a failure rolls back
  // and leaves the log intact.
  compacting: {
    'compact-ok': 'ready',
    'compact-error': 'ready',
  },
  // Asleep with its sockets still open. The next message or connection wakes it, and waking
  // means reading the board back.
  hibernated: {
    wake: 'loading',
    connection: 'loading',
  },
  // A write failed: every socket was hung up and the document thrown away. A new connection
  // reads the board back from what storage does hold.
  'storage-failed': {
    wake: 'loading',
    connection: 'loading',
  },
  // The board would not load. Only a connection can end this, and only once the retry
  // interval has passed; before that the room refuses the connection and stays as it is.
  'load-failed': {
    connection: 'loading',
  },
};

/** The event the state is asked about, with the retry interval elapsed. */
function eventOf(type: RoomEvent['type']): RoomEvent {
  return type === 'connection' ? { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS } : { type };
}

describe('TC-27 every edge of the room state diagram', () => {
  it('loads into a ready room when the saved board can be read', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('is still ready when some log rows had to be quarantined on the way in', () => {
    // The room applies what it can read and counts the rows it could not; a board with one
    // damaged change in it is a board that loaded (persist.partial_damage).
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('refuses to serve when the saved board cannot be read', () => {
    expect(nextRoomState('loading', { type: 'load-error' })).toBe('load-failed');
  });

  it('keeps serving through an edit, a fold-up and a dormant period', () => {
    expect(nextRoomState('ready', { type: 'update' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'compact' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'compact-ok' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  it('comes back from a failed fold-up without leaving the room folded', () => {
    // The transaction rolled back and the log is intact, which is exactly the state a ready
    // room was in before it tried.
    expect(nextRoomState('compacting', { type: 'compact-error' })).toBe('ready');
  });

  it('leaves a room that could not write out of service until a new connection', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
    expect(nextRoomState('storage-failed', { type: 'connection', msSinceLoadFailure: 0 })).toBe(
      'loading',
    );
    expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
  });

  it('wakes a dormant room for a message as well as for a person', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    expect(nextRoomState('hibernated', { type: 'connection', msSinceLoadFailure: 0 })).toBe(
      'loading',
    );
  });

  it('tries to load again on a connection once the retry interval has passed', () => {
    expect(
      nextRoomState('load-failed', { type: 'connection', msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS }),
    ).toBe('loading');
    expect(
      nextRoomState('load-failed', {
        type: 'connection',
        msSinceLoadFailure: LOAD_RETRY_MIN_INTERVAL_MS + 1,
      }),
    ).toBe('loading');
  });

  it('keeps turning people away, and stays broken, before the interval has passed', () => {
    // This is the state that answers with CLOSE_BOARD_LOAD_FAILED: the room does not pretend
    // to be empty, and it does not spend a load attempt on every reconnect.
    for (const ms of [0, 1, LOAD_RETRY_MIN_INTERVAL_MS - 1]) {
      expect(nextRoomState('load-failed', { type: 'connection', msSinceLoadFailure: ms })).toBe(
        'load-failed',
      );
    }
  });

  it('walks the golden path of a board: wake, load, edit, fold up, sleep, wake, load', () => {
    const path = [
      { state: 'loading' as LifecycleState, event: eventOf('load-ok') },
      { state: 'ready' as LifecycleState, event: eventOf('update') },
      { state: 'ready' as LifecycleState, event: eventOf('compact') },
      { state: 'compacting' as LifecycleState, event: eventOf('compact-ok') },
      { state: 'ready' as LifecycleState, event: eventOf('hibernate') },
      { state: 'hibernated' as LifecycleState, event: eventOf('wake') },
      { state: 'loading' as LifecycleState, event: eventOf('load-ok') },
    ];
    let expected: LifecycleState = 'loading';
    for (const step of path) {
      expected = nextRoomState(step.state, step.event);
      expect([step.state, step.event.type, expected]).toEqual([
        step.state,
        step.event.type,
        EDGES[step.state][step.event.type],
      ]);
    }
    expect(expected).toBe('ready');
  });

  it('answers every edge of the diagram, and nothing else', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        const expected = EDGES[state][event.type] ?? state;
        expect([state, event.type, nextRoomState(state, event)]).toEqual([
          state,
          event.type,
          expected,
        ]);
      }
    }
  });

  it('leaves a state alone when the event makes no sense for it', () => {
    // The negative half of the table above, spelled out for the states a bug could get wrong.
    expect(nextRoomState('loading', { type: 'update' })).toBe('loading');
    expect(nextRoomState('loading', { type: 'storage-error' })).toBe('loading');
    expect(nextRoomState('loading', { type: 'hibernate' })).toBe('loading');
    expect(nextRoomState('loading', { type: 'connection', msSinceLoadFailure: 99_999 })).toBe(
      'loading',
    );
    expect(nextRoomState('ready', { type: 'wake' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'load-ok' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'load-error' })).toBe('ready');
    expect(nextRoomState('ready', { type: 'compact-ok' })).toBe('ready');
    expect(nextRoomState('compacting', { type: 'update' })).toBe('compacting');
    expect(nextRoomState('compacting', { type: 'storage-error' })).toBe('compacting');
    expect(nextRoomState('hibernated', { type: 'update' })).toBe('hibernated');
    expect(nextRoomState('hibernated', { type: 'load-ok' })).toBe('hibernated');
    expect(nextRoomState('storage-failed', { type: 'update' })).toBe('storage-failed');
    expect(nextRoomState('load-failed', { type: 'wake' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'update' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'load-ok' })).toBe('load-failed');
    expect(nextRoomState('load-failed', { type: 'storage-error' })).toBe('load-failed');
  });
});
