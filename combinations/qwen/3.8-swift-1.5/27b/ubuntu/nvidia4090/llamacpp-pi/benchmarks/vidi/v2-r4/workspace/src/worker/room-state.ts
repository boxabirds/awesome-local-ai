import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * Full lifecycle states of a board room (see the design's room state diagram).
 *
 * The "settled" states a room rests in are `ready`, `load-failed` and `storage-failed`;
 * `loading`, `compacting` and `hibernated` are transient.
 */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed' }
  | { type: 'update-stored' }
  | { type: 'compaction-start' }
  | { type: 'compaction-success' }
  | { type: 'compaction-rollback' }
  | { type: 'storage-error' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  /** A new connection arrived. `elapsedMs` is time since the last load attempt. */
  | { type: 'new-connection'; elapsedMs: number };

/**
 * Pure transition function for the room lifecycle (TC-27).
 * Valid events move the state as in the design diagram; any other event leaves the
 * state unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update-stored':
          return 'ready';
        case 'compaction-start':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compaction-success':
        case 'compaction-rollback':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }
    case 'hibernated':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }
    case 'load-failed':
      switch (event.type) {
        case 'new-connection':
          // Retry the load only once the minimum interval has elapsed; otherwise stay
          // failed (the room closes the socket with 4500).
          return event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
        default:
          return state;
      }
    default:
      return state;
  }
}
