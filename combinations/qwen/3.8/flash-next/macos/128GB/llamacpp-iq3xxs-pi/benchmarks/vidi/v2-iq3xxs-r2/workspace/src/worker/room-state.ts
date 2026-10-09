/**
 * The board room's lifecycle as one pure function, straight off the design's state
 * diagram: `loading` when the object is constructed or woken, `ready` serving updates,
 * `compacting` while a snapshot replaces the log, `storage-failed` after a failed
 * write (until the next connection reloads), `hibernated` with hibernatable sockets
 * and no compute, and `load-failed` when the saved board cannot be read, which only
 * retries after `LOAD_RETRY_MIN_INTERVAL_MS` has passed.
 */

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'load-failed'
  | 'storage-failed';

export type RoomEvent =
  /** Snapshot and log applied (damaged log rows quarantined still counts). */
  | { type: 'load-ok' }
  /** Snapshot unreadable or SQL error: the room refuses to serve an empty doc. */
  | { type: 'load-error' }
  /** One update applied, stored and broadcast. */
  | { type: 'update-applied' }
  /** The log passed `shouldCompact`; the next thing the room does is compact. */
  | { type: 'log-over-threshold' }
  /** Snapshot replaced and log truncated in one transaction. */
  | { type: 'compaction-done' }
  /** Compaction threw: the transaction rolled back and the log is intact. */
  | { type: 'compaction-error' }
  /** A storage write threw: sockets closed, doc discarded. */
  | { type: 'storage-error' }
  /** No traffic and hibernatable sockets still open: the object may go. */
  | { type: 'idle-with-sockets' }
  /** A message or a new connection wakes a hibernated object. */
  | { type: 'woken' }
  /** Somebody connected. `afterRetryInterval` is the room's `LOAD_RETRY_MIN_INTERVAL_MS` clock. */
  | { type: 'connection'; afterRetryInterval?: boolean };

/**
 * The next state for one event, or the same state for an event this state ignores or
 * does not know (`tests/unit/room-state.test.ts`, TC-27). Invalid events never move
 * the room.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      // While loading, only the outcome of the load counts.
      switch (event.type) {
        case 'load-ok':
          return 'ready';
        case 'load-error':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update-applied':
        case 'connection':
        case 'woken':
          return 'ready';
        case 'log-over-threshold':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'idle-with-sockets':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      // Compaction is synchronous: whatever its outcome, the room serves again
      // (a rolled-back failure leaves the intact log to do the work).
      switch (event.type) {
        case 'compaction-done':
        case 'compaction-error':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      // The doc is gone and the sockets were dropped; only a new connection can
      // bring the room back, by loading afresh.
      return event.type === 'connection' ? 'loading' : state;
    case 'hibernated':
      // Any traffic wakes a hibernated object, and the wake always starts with a load.
      return event.type === 'woken' || event.type === 'connection' ? 'loading' : state;
    case 'load-failed':
      // Load failures are retried, but at most once per LOAD_RETRY_MIN_INTERVAL_MS:
      // a connection before the interval is refused without a new attempt.
      return event.type === 'connection' && event.afterRetryInterval === true
        ? 'loading'
        : state;
  }
}
