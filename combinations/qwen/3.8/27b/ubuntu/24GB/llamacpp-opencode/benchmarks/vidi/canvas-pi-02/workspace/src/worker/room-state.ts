/**
 * BoardRoom lifecycle state machine (story 4, `persist.state_machine`).
 *
 * One pure function maps (state, event) → next state, mirroring the design's
 * room lifecycle diagram. Invalid events for a state leave it unchanged
 * (never throw). Time-dependent transitions (LoadFailed → Loading) are
 * encoded by the caller in the event (`retryAllowed` = at least
 * `LOAD_RETRY_MIN_INTERVAL_MS` since the last failed attempt).
 */

/** Room lifecycle states (design diagram). */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'load-failed'
  | 'storage-failed';

/** Events that move a room between states. */
export type RoomEvent =
  | { type: 'loaded'; quarantined: number }
  | { type: 'load-failed'; reason: string }
  | { type: 'compaction-start' }
  | { type: 'compaction-done'; success: boolean }
  | { type: 'storage-failed' }
  | { type: 'hibernated' }
  | { type: 'woken' }
  | {
      type: 'connected';
      /** True when at least LOAD_RETRY_MIN_INTERVAL_MS passed since the last failed load attempt. */
      retryAllowed: boolean;
    };

/**
 * Pure transition function. Returns the next state; an event that is invalid
 * for the current state returns the state unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
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
        case 'compaction-start':
          return 'compacting';
        case 'storage-failed':
          return 'storage-failed';
        case 'hibernated':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      // Compaction is a single synchronous transaction: only its own
      // completion event (success or rollback) applies, and both return Ready.
      return event.type === 'compaction-done' ? 'ready' : state;
    case 'hibernated':
      // A message or a new connection wakes the object (platform-level
      // event, surfaced as `woken`); the document reloads from storage.
      return event.type === 'woken' ? 'loading' : state;
    case 'storage-failed':
      // The doc was discarded and every socket closed; the next connection
      // starts a fresh load. (If the platform hibernates the idle instance
      // meanwhile, the wake reconstructs the object from scratch, which is
      // also a fresh load — same outcome.)
      return event.type === 'connected' ? 'loading' : state;
    case 'load-failed':
      // The board is unreadable; retry at most once per retry interval.
      // Connections before the interval are closed (4500) without a reload.
      return event.type === 'connected' && event.retryAllowed ? 'loading' : state;
  }
}
