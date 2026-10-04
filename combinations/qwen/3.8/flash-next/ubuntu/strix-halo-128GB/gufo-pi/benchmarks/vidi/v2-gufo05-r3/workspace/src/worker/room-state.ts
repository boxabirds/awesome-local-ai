/**
 * The board room's lifecycle as one pure function, so every edge of the state
 * diagram is testable without a Durable Object, a socket or a database.
 *
 * ```text
 *  [*] --> loading            object constructed or woken
 *  loading --> ready          snapshot and log applied (rest applied after quarantine)
 *  loading --> load-failed    snapshot unreadable or SQL error
 *  ready --> ready            update applied, stored, broadcast
 *  ready --> compacting       log exceeds a threshold
 *  compacting --> ready       snapshot replaced and log truncated (or rolled back)
 *  ready --> storage-failed   an insert threw
 *  storage-failed --> loading sockets closed, document discarded, next connection
 *  ready --> hibernated       nothing to do, sockets may stay open
 *  hibernated --> loading     a message or a new connection wakes the object
 *  load-failed --> loading    a new connection after LOAD_RETRY_MIN_INTERVAL_MS
 *  load-failed --> load-failed a connection before that interval (closed with 4500)
 * ```
 *
 * An event a state does not answer to leaves the state unchanged: a room is
 * never pushed into an impossible situation by traffic arriving out of order.
 */

import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** `loading` and `compacting` are internal; the other four are observable. */
export type RoomStateName =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  /** The snapshot and the update log were applied to a fresh document. */
  | { type: 'load-succeeded' }
  /** The snapshot could not be read, or SQL itself failed. */
  | { type: 'load-failed' }
  /** An update was applied, written and relayed. */
  | { type: 'update-applied' }
  /** The log passed a compaction threshold. */
  | { type: 'compaction-needed' }
  /** Compaction committed, or failed and rolled back — either way, ready. */
  | { type: 'compaction-finished' }
  /** A write threw: the room can no longer promise that anything is saved. */
  | { type: 'storage-error' }
  /** Nothing left to do; the object may be evicted while sockets stay open. */
  | { type: 'idle' }
  /** A message or connection woke an evicted object, so the board is reloaded. */
  | { type: 'woken' }
  /** A client connected to a room that had discarded its document. */
  | { type: 'next-connection' }
  /** A client connected to a room that failed to load, `elapsedMs` after that. */
  | { type: 'connect'; elapsedMs: number };

/** True when a load-failed room may try again. */
export function isLoadRetryDue(elapsedMs: number): boolean {
  return elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS;
}

/**
 * The close code a freshly accepted socket gets from a room in `state`, or
 * `null` when the room can serve it.
 */
export function clientCloseCode(state: RoomStateName): number | null {
  if (state === 'load-failed') return CLOSE_BOARD_LOAD_FAILED;
  if (state === 'storage-failed') return CLOSE_STORAGE_FAILURE;
  return null;
}

/** The next state, or `state` itself for an event it does not answer to. */
export function nextRoomState(state: RoomStateName, event: RoomEvent): RoomStateName {
  switch (state) {
    case 'loading':
      if (event.type === 'load-succeeded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;

    case 'ready':
      if (event.type === 'compaction-needed') return 'compacting';
      if (event.type === 'storage-error') return 'storage-failed';
      if (event.type === 'idle') return 'hibernated';
      // `update-applied` is the steady loop; anything else changes nothing.
      return state;

    case 'compacting':
      // Both outcomes end the interlude: committed, or rolled back with the
      // previous snapshot and log still in place.
      if (event.type === 'compaction-finished') return 'ready';
      return state;

    case 'storage-failed':
      if (event.type === 'next-connection') return 'loading';
      return state;

    case 'hibernated':
      if (event.type === 'woken' || event.type === 'next-connection') return 'loading';
      return state;

    case 'load-failed':
      if (event.type === 'connect') {
        return isLoadRetryDue(event.elapsedMs) ? 'loading' : 'load-failed';
      }
      return state;

    default:
      return state;
  }
}
