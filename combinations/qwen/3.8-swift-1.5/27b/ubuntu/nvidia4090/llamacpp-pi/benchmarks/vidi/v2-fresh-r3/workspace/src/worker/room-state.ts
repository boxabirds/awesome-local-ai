/**
 * Pure model of the BoardRoom lifecycle (story 4). Mirrors the design's room
 * state diagram so the transitions are unit-testable in isolation.
 *
 * The BoardRoom tracks the three "resting" states (ready / load-failed /
 * storage-failed) at runtime; `loading`, `compacting` and `hibernated` are
 * transient/implicit. `nextRoomState` is the canonical transition function for
 * every edge of the diagram; invalid events leave the state unchanged.
 */

export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  /** snapshot and log applied (also: log rows quarantined, rest applied) */
  | 'load-success'
  /** snapshot unreadable or SQL error during load */
  | 'load-failed'
  /** an update was applied, stored and broadcast (stays ready) */
  | 'update-applied'
  /** the log exceeded the compaction threshold */
  | 'compact-start'
  /** snapshot replaced + log truncated (also: compaction rolled back, log intact) */
  | 'compact-done'
  /** an append threw */
  | 'storage-error'
  /** sockets closed, doc discarded, next connection reloads */
  | 'reconnect'
  /** no events; sockets may stay open (hibernation) */
  | 'hibernate'
  /** a message or new connection wakes the object */
  | 'wake'
  /** new connection after LOAD_RETRY_MIN_INTERVAL_MS */
  | 'retry-load'
  /** connection before the interval: stays load-failed, close 4500 */
  | 'retry-blocked';

/**
 * The canonical lifecycle transitions. Keyed by `${state}|${event}`. Any
 * (state, event) pair not present here is invalid and leaves the state
 * unchanged.
 */
const TRANSITIONS: Record<string, RoomLifecycleState> = {
  'loading|load-success': 'ready',
  'loading|load-failed': 'load-failed',
  'ready|update-applied': 'ready',
  'ready|compact-start': 'compacting',
  'ready|storage-error': 'storage-failed',
  'ready|hibernate': 'hibernated',
  'compacting|compact-done': 'ready',
  'storage-failed|reconnect': 'loading',
  'hibernated|wake': 'loading',
  'load-failed|retry-load': 'loading',
  'load-failed|retry-blocked': 'load-failed',
};

/**
 * Returns the next lifecycle state for `(state, event)`. Invalid events for a
 * state leave the state unchanged.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
): RoomLifecycleState {
  return TRANSITIONS[`${state}|${event}`] ?? state;
}
