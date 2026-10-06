/**
 * The board room's lifecycle as a pure state machine (story 4).
 *
 * A room spends its life in one of these states; every one of them says something about
 * what a person opening the board should see:
 *
 * ```text
 *   loading         the board is being read from storage; nobody is served yet
 *   ready           the document is in memory and every change is written before it is sent
 *   compacting      the update log is being folded into a fresh snapshot
 *   hibernated      no events pending; the runtime may have thrown the memory away
 *   load-failed     the board could not be read: it is *not* empty, it is unreadable
 *   storage-failed  a change could not be written: nothing was broadcast, sockets are closed
 * ```
 *
 * The transitions are exactly the design's lifecycle diagram:
 *
 * ```text
 *   [*] -> loading            object constructed or woken
 *   loading -> ready          snapshot and log applied (log rows may be quarantined first)
 *   loading -> load-failed    snapshot unreadable or SQL error
 *   ready -> ready            update applied, stored, broadcast
 *   ready -> compacting       log exceeds a threshold
 *   compacting -> ready       snapshot replaced log truncated (or the failure rolled back)
 *   ready -> storage-failed   insert throws
 *   storage-failed -> loading sockets closed, document discarded, next connection reloads
 *   ready -> hibernated       no events; sockets may stay open
 *   hibernated -> loading     a message or a new connection wakes the object
 *   load-failed -> loading    a new connection after LOAD_RETRY_MIN_INTERVAL_MS
 *   load-failed -> load-failed a connection before then, closed with 4500
 * ```
 *
 * Keeping this separate from the Durable Object means the whole lifecycle is testable
 * without a runtime, and the object itself only has to ask what comes next.
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** The states a room can serve (or refuse) connections from. */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/** Every state in the lifecycle, including the transient ones. */
export type RoomLifecycleState = 'loading' | 'compacting' | 'hibernated' | RoomState;

/** Something that can happen to a room. */
export type RoomEvent =
  /**
   * The snapshot and the log were applied to a fresh document. Log rows that could not be
   * read are quarantined first, so this edge covers both "everything applied" and
   * "one damaged row set aside, the rest applied".
   */
  | { type: 'loaded' }
  /** The snapshot could not be read, or a query failed. */
  | { type: 'load-failed' }
  /** A change was applied to the document, written to storage and broadcast. */
  | { type: 'update-applied' }
  /** The log grew past a compaction threshold. */
  | { type: 'compaction-started' }
  /** The new snapshot is committed and the log rows it covers are gone. */
  | { type: 'compaction-finished' }
  /** Compaction failed and rolled back: the old snapshot and the whole log are intact. */
  | { type: 'compaction-failed' }
  /** Writing an update threw: the change was not broadcast and the document is dropped. */
  | { type: 'storage-failed' }
  /** A connection arrives at a room that dropped its document after a storage failure. */
  | { type: 'reload' }
  /** The runtime is keeping the object alive without its memory. */
  | { type: 'hibernated' }
  /** A message or connection wakes a hibernated object. */
  | { type: 'woken' }
  /**
   * A connection arrives at a room that failed to load. `elapsedMs` is the time since that
   * failure: retrying sooner than `LOAD_RETRY_MIN_INTERVAL_MS` would only repeat the failure.
   */
  | { type: 'retry-load'; elapsedMs: number };

/**
 * Whether a board whose load failed `elapsedMs` ago may be read again.
 *
 * A connection that arrives sooner is refused the same way as before - accepted and closed
 * with `CLOSE_BOARD_LOAD_FAILED` - instead of repeating a read that just failed.
 */
export function loadRetryAllowed(elapsedMs: number): boolean {
  return elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS;
}

/**
 * The next state, or the same one for an event that does not apply here. An event that
 * cannot happen in a given state is ignored rather than fatal: the room is a long-lived
 * object and a stray event must never strand a board in a state nothing can leave.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'loaded':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update-applied':
          return 'ready';
        case 'compaction-started':
          return 'compacting';
        case 'storage-failed':
          return 'storage-failed';
        case 'hibernated':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compaction-finished':
        case 'compaction-failed':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'reload':
          return 'loading';
        default:
          return state;
      }
    case 'hibernated':
      switch (event.type) {
        case 'woken':
          return 'loading';
        default:
          return state;
      }
    case 'load-failed':
      switch (event.type) {
        case 'retry-load':
          return loadRetryAllowed(event.elapsedMs) ? 'loading' : 'load-failed';
        default:
          return state;
      }
  }
}
