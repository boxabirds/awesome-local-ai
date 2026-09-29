/**
 * The pure lifecycle state machine for a persistent {@link BoardRoom}
 * (`persist.room`). It models the design's room lifecycle diagram as a pure function
 * so every transition edge can be unit-tested without a Durable Object, storage, or a
 * socket. The `BoardRoom` keeps only the coarse runtime states it needs to route
 * messages; this module is the reference model those routing checks follow.
 *
 * Diagram edges covered:
 *   Loading -> Ready                          (load applied cleanly)
 *   Loading -> Ready (quarantined)            (load applied, damaged rows quarantined)
 *   Loading -> LoadFailed                     (snapshot unreadable or SQL read error)
 *   Ready -> Compacting -> Ready              (compaction succeeds)
 *   Compacting -> Ready                       (compaction failed: rolled back, log intact)
 *   Ready -> StorageFailed                    (an insert threw)
 *   StorageFailed -> Loading                  (sockets closed, doc discarded, reload on next event)
 *   Ready -> Hibernated                       (no events; sockets may stay open)
 *   Hibernated -> Loading                     (a message or new connection wakes the object)
 *   LoadFailed -> Loading                     (a new connection, but only after LOAD_RETRY_MIN_INTERVAL_MS)
 *   LoadFailed -> LoadFailed                  (a connection before the interval: stays, closes 4500)
 */
export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'load-failed'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated';

export type RoomLifecycleEvent =
  | 'load-applied'
  | 'load-applied-quarantined'
  | 'load-failed'
  | 'compact'
  | 'compact-success'
  | 'compact-failure'
  | 'storage-error'
  | 'storage-recovered'
  | 'idle'
  | 'wake'
  | 'open';

/** Events a `LoadFailed` room is willing to reload on, as opposed to just closing 4500. */
const LOAD_RETRY_EVENTS: ReadonlySet<RoomLifecycleEvent> = new Set(['wake', 'open']);

/**
 * The next lifecycle state for `(state, event)`. An event that has no defined edge for
 * the current state leaves it unchanged (the negative case: an invalid event is inert).
 * `compact-failure` also leaves the state at `compacting` in the sense that the *stored*
 * data is rolled back; the room returns to `ready` because the next append retries, but
 * the model distinguishes the rollback event so a test can assert the log survived.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomLifecycleEvent,
): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event) {
        case 'load-applied':
        case 'load-applied-quarantined':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event) {
        case 'compact':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event) {
        case 'compact-success':
          return 'ready';
        // A failed compaction rolls the transaction back: the previous snapshot and
        // every log row are intact, so the room is usable again immediately.
        case 'compact-failure':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event) {
        // Sockets are closed and the doc discarded; the next connection reloads.
        case 'storage-recovered':
        case 'wake':
        case 'open':
          return 'loading';
        default:
          return state;
      }
    case 'hibernated':
      switch (event) {
        case 'wake':
        case 'open':
          return 'loading';
        default:
          return state;
      }
    case 'load-failed':
      // A retry is only *attempted* after LOAD_RETRY_MIN_INTERVAL_MS; whether enough
      // time passed is a caller concern (the room holds the failure timestamp). Here a
      // retry-eligible event moves to Loading; a connection that arrives too early is
      // closed 4500 by the caller and is represented by the non-retry events below.
      switch (event) {
        case 'wake':
          return 'loading';
        case 'open':
          return 'loading';
        default:
          return state;
      }
    default:
      return state;
  }
}

/** True when `event` is one a `LoadFailed` room treats as a reload attempt. */
export const isLoadRetryEvent = (event: RoomLifecycleEvent): boolean =>
  LOAD_RETRY_EVENTS.has(event);
