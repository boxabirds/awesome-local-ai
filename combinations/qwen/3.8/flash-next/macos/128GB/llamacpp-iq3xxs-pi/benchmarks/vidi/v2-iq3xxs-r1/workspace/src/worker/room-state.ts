/**
 * The board room's lifecycle, as a pure state machine (design "State diagrams":
 * room lifecycle). Nothing here touches a socket, a document or storage: the room
 * owns those, and calls `nextRoomState` to decide what it is allowed to do next.
 * Keeping the transitions in one pure function makes every edge — including the
 * negative ones ("an event this state does not handle changes nothing") — a unit
 * test rather than a race in an integration test (TC-27).
 *
 * The operational `RoomState` a `BoardRoom` stores (`ready` / `load-failed` /
 * `storage-failed`) is the three states that outlive a single call: `loading` and
 * `compacting` are synchronous stretches inside one call, and `hibernated` is the
 * runtime having evicted the object entirely, so the room never stores it.
 */

/** Every state of the design's room lifecycle diagram. */
export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** Every event the room can report, with the payload a decision depends on. */
export type RoomEvent =
  /** The object was constructed, woke on a message, or recovers on a new connection. */
  | { type: 'wake' }
  /** The snapshot and log applied cleanly. */
  | { type: 'load-ok' }
  /** The load applied everything it could; at least one log row was quarantined. */
  | { type: 'load-quarantined' }
  /** The snapshot was unreadable, or SQL itself failed. */
  | { type: 'load-failed' }
  /** An update was applied and stored, then broadcast. */
  | { type: 'update' }
  /** The log grew past a compaction threshold. */
  | { type: 'compact-needed' }
  /** The snapshot was replaced and the log truncated. */
  | { type: 'compact-ok' }
  /** Compaction threw, the transaction rolled back, and the log is intact. */
  | { type: 'compact-failed' }
  /** A storage write threw: the change is not broadcast and the doc is discarded. */
  | { type: 'storage-error' }
  /** Nobody is connected; the runtime may evict the object. */
  | { type: 'idle' }
  /**
   * A connection arrived at a LoadFailed room. `intervalElapsed` is whether
   * `LOAD_RETRY_MIN_INTERVAL_MS` has passed since the failure: before it the room
   * refuses without another attempt, after it the room tries to load again.
   */
  | { type: 'retry'; intervalElapsed: boolean };

/**
 * The next state for `(state, event)`, or `state` unchanged for any event this
 * state does not handle. The invalid events are the negative half of TC-27: an
 * event that only makes sense in another state must never move this one.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-ok':
        case 'load-quarantined':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }

    case 'ready':
      switch (event.type) {
        case 'update':
          return 'ready';
        case 'compact-needed':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return state;
      }

    case 'compacting':
      // Both outcomes land back in ready; a failed compaction rolled its
      // transaction back, so the log is exactly as it was.
      switch (event.type) {
        case 'compact-ok':
        case 'compact-failed':
          return 'ready';
        default:
          return state;
      }

    case 'storage-failed':
      // Sockets were closed and the document discarded; the next connection
      // reloads from storage.
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    case 'hibernated':
      // A message or a new connection wakes the object and reloads the document.
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    case 'load-failed':
      switch (event.type) {
        // Only after LOAD_RETRY_MIN_INTERVAL_MS does a connection trigger a fresh
        // load attempt; before it, the room stays failed (and closes 4500).
        case 'retry':
          return event.intervalElapsed ? 'loading' : 'load-failed';
        default:
          return state;
      }
  }
}
