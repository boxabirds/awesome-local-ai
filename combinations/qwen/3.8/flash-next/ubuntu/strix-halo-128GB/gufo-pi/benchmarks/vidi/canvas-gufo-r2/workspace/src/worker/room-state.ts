/**
 * The room's load/serve lifecycle as a pure transition function, so the state
 * diagram in the design can be covered without instantiating a Durable Object.
 * `BoardRoom` keeps the states it can actually observe (`loading`, `ready`,
 * `load-failed`, `storage-failed`); `compacting` and `hibernated` are transient
 * (compaction is synchronous) or platform-driven (WebSocket hibernation), and
 * are modelled here so the diagram is explicit.
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomLifecycleEvent =
  /** Snapshot and log applied to the doc. */
  | { type: 'load-ok' }
  /** Snapshot unreadable, or a SQL statement threw during the load. */
  | { type: 'load-failed' }
  /** Un-compacted log passed a threshold. */
  | { type: 'compact-start' }
  /** Snapshot replaced and log truncated. */
  | { type: 'compact-done' }
  /** Compaction threw; the transaction rolled back. */
  | { type: 'compact-failed' }
  /** A write threw; the room stops serving. */
  | { type: 'storage-error' }
  /** Sockets closed, doc discarded, a new connection arrives. */
  | { type: 'reconnect' }
  /** No events; sockets may stay open. */
  | { type: 'idle' }
  /** A message or new connection wakes the object. */
  | { type: 'wake' }
  /** A connection arrives while the load failure is remembered. */
  | { type: 'connect-after-load-failure'; elapsedMs: number };

/**
 * Next state for (state, event). An event that does not apply to a state
 * leaves the state unchanged.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomLifecycleEvent,
): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-ok':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'compact-start':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compact-done':
        case 'compact-failed':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'reconnect':
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
        case 'connect-after-load-failure':
          return event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
        default:
          return state;
      }
  }
}
