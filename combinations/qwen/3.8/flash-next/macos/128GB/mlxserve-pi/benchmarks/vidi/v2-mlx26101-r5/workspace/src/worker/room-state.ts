/**
 * The board room's lifecycle, as a pure function.
 *
 * `BoardRoom` spends its life in a handful of states and every interesting behaviour in
 * story 4 is a question about which state it is in — "may this socket be served the board,
 * or must it be closed with 4500?", "is the document still ours to broadcast from?". Those
 * questions are answered here, once, with no Durable Object, no SQLite and no clocks in
 * sight, so the whole state diagram is testable edge by edge (TC-27).
 *
 * The diagram this table encodes (from the design):
 *
 *   loading        -> ready          load-ok        (snapshot and log applied)
 *   loading        -> ready          load-quarantined (damaged log rows set aside, rest applied)
 *   loading        -> load-failed    load-error     (snapshot unreadable, or SQL error)
 *   ready          -> ready          update-applied (stored, then broadcast)
 *   ready          -> compacting     compact-needed (log past its threshold)
 *   compacting     -> ready          compact-ok     (snapshot replaced, log truncated)
 *   compacting     -> ready          compact-error  (rolled back, log intact)
 *   ready          -> storage-failed append-error   (a change could not be written down)
 *   storage-failed -> loading        reconnect      (sockets closed, doc discarded, next connection)
 *   ready          -> hibernated     idle           (nothing to do; sockets may stay open)
 *   hibernated     -> loading        wake           (a message or a new connection)
 *   load-failed    -> loading        retry-load     (a new connection, after the retry interval)
 *   load-failed    -> load-failed    reject-load    (a connection before the interval: closed 4500)
 *
 * An event that means nothing in a state leaves that state unchanged; that is the whole
 * answer to "what happens when two things happen at once" — the room finishes what it is
 * in and ignores the rest.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** Where the room is. */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** Something that happens to the room. */
export type RoomEvent =
  | 'load-ok'
  | 'load-quarantined'
  | 'load-error'
  | 'update-applied'
  | 'compact-needed'
  | 'compact-ok'
  | 'compact-error'
  | 'append-error'
  | 'reconnect'
  | 'idle'
  | 'wake'
  | 'retry-load'
  | 'reject-load';

/** Every state the room can be in, in diagram order. */
export const ROOM_STATES: readonly RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

/** Every event the room can react to, in diagram order. */
export const ROOM_EVENTS: readonly RoomEvent[] = [
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
];

/** The transitions: for each state, the events it understands and where they lead. */
const TRANSITIONS: Readonly<Partial<Record<RoomState, Partial<Record<RoomEvent, RoomState>>>>> = {
  loading: {
    'load-ok': 'ready',
    'load-quarantined': 'ready',
    'load-error': 'load-failed',
  },
  ready: {
    'update-applied': 'ready',
    'compact-needed': 'compacting',
    'append-error': 'storage-failed',
    idle: 'hibernated',
  },
  compacting: {
    'compact-ok': 'ready',
    'compact-error': 'ready',
  },
  'storage-failed': {
    reconnect: 'loading',
  },
  hibernated: {
    wake: 'loading',
  },
  'load-failed': {
    'retry-load': 'loading',
    // Kept in the table so the table is total over what the room does here: a connection
    // that arrives too early to retry is answered from the same state.
    'reject-load': 'load-failed',
  },
};

/**
 * The state the room is in after `event`, or `state` itself when the event means nothing
 * here. Total over every (state, event) pair, so a caller can never be surprised by an
 * `undefined`.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  return TRANSITIONS[state]?.[event] ?? state;
}

/** True when `event` changes anything about `state`. */
export function isRoomEventHandled(state: RoomState, event: RoomEvent): boolean {
  return TRANSITIONS[state]?.[event] !== undefined;
}

/**
 * Whether a room that could not read its board should try again: only once
 * `intervalMs` has gone by since it failed.
 *
 * The state machine cannot answer this on its own — it has no clock, and that is deliberate,
 * because a state machine that reads the time cannot be tested edge by edge. The room asks
 * this instead of guessing, which is what makes the boundary (`LOAD_RETRY_MIN_INTERVAL_MS`
 * exactly) a thing a test can stand on. Before it, the room answers the connection from the
 * state it is already in: closed with 4500, and no read attempted at all.
 */
export function shouldRetryLoad(
  now: number,
  failedAt: number,
  intervalMs: number = LOAD_RETRY_MIN_INTERVAL_MS,
): boolean {
  return now - failedAt >= intervalMs;
}

/** The event a connection gets in a room that could not read its board: retry, or refuse. */
export function loadRetryEvent(
  now: number,
  failedAt: number,
  intervalMs: number = LOAD_RETRY_MIN_INTERVAL_MS,
): RoomEvent {
  return shouldRetryLoad(now, failedAt, intervalMs) ? 'retry-load' : 'reject-load';
}
