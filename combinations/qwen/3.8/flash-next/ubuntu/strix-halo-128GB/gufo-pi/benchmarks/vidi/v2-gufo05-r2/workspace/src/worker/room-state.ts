/**
 * persist.room: the `BoardRoom` lifecycle as a pure transition function, so the
 * edges of the design's state diagram are testable without a Durable Object.
 *
 * ```
 *  [*] -> loading : object constructed or woken
 *  loading -> ready : snapshot and log applied (damaged rows quarantined first)
 *  loading -> load-failed : snapshot unreadable or SQL error
 *  ready -> ready : update applied, stored, broadcast
 *  ready -> compacting : the log crossed a threshold
 *  compacting -> ready : snapshot replaced and log truncated (or the attempt
 *                        rolled back with the log intact)
 *  ready -> storage-failed : an insert threw
 *  storage-failed -> loading : sockets closed, doc discarded, next connection reloads
 *  ready -> hibernated : no events; sockets may stay open
 *  hibernated -> loading : a message or a new connection wakes the object
 *  load-failed -> load-failed : a connection before LOAD_RETRY_MIN_INTERVAL_MS
 *  load-failed -> loading : a connection after it
 * ```
 *
 * An event that has no edge out of the current state leaves it unchanged: the
 * room cannot be pushed into a state it has no path to.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  /** The object was constructed or woken and is reading storage. */
  | { type: 'load' }
  /** The snapshot and the log after it were applied. */
  | { type: 'loaded' }
  /** The snapshot could not be read, or SQL failed. */
  | { type: 'load-failed' }
  /** Someone's update was applied, stored and broadcast. */
  | { type: 'update' }
  /** Traffic arrived (a sync or awareness frame). */
  | { type: 'message' }
  /** The log crossed a compaction threshold. */
  | { type: 'compact' }
  /** Compaction finished — committed, or rolled back with the log intact. */
  | { type: 'compacted' }
  /** A storage write failed: the room resets instead of pretending. */
  | { type: 'storage-error' }
  /** Discard the document and read it again from storage. */
  | { type: 'reload' }
  /** Nothing left to do; the object may be evicted with sockets held. */
  | { type: 'hibernate' }
  /** A client opened a socket. In `load-failed` this is the load retry. */
  | { type: 'connection'; now: number; lastLoadAttemptAt: number };

/** Whether a load-failed room may read storage again. */
export function loadRetryAllowed(lastLoadAttemptAt: number, now: number): boolean {
  return now - lastLoadAttemptAt >= LOAD_RETRY_MIN_INTERVAL_MS;
}

/** The state after `event`; unchanged when the diagram has no such edge. */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      // Storage is being read, and nothing else runs until it finished
      // (`blockConcurrencyWhile`), so only the load outcome moves this state.
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return 'loading';

    case 'ready':
      switch (event.type) {
        case 'compact':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        case 'reload':
          return 'loading';
        // `update`, `message` and `connection` are an ordinary moment on a live
        // board. `load-failed` is deliberately absent: a board that is serving
        // people never starts claiming it could not be loaded.
        default:
          return 'ready';
      }

    case 'compacting':
      // Compaction reports back one way or the other (it swallows its own errors
      // after rolling back), so this state always ends at ready.
      return event.type === 'compacted' ? 'ready' : 'compacting';

    case 'storage-failed':
      // The document is gone; the next connection reads it back from storage.
      if (event.type === 'connection' || event.type === 'reload') return 'loading';
      return 'storage-failed';

    case 'hibernated':
      if (event.type === 'message' || event.type === 'connection') return 'loading';
      return 'hibernated';

    case 'load-failed':
      // The only way out is a connection, and only after the retry interval:
      // until then the room answers by closing with CLOSE_BOARD_LOAD_FAILED.
      if (event.type === 'connection' && loadRetryAllowed(event.lastLoadAttemptAt, event.now)) {
        return 'loading';
      }
      return 'load-failed';
  }
}
