/**
 * Durable room state machine (story 4, design "Durable-room state machine").
 *
 *   [*] -> Loading
 *   Loading    --load-success (incl. quarantined rows)--> Ready
 *   Loading    --load-failure (snapshot | SQL)----------> LoadFailed
 *   Ready      --client update--------------------------> Ready
 *   Ready      --compaction start----------------------> Compacting
 *   Compacting --success | rollback (back to log)------> Ready
 *   Ready      --storage write failure-----------------> StorageFailed
 *   Ready      --all clients gone (workerd evict)------> Hibernated
 *   Hibernated --wake (new connection)-----------------> Loading
 *   StorageFailed --wake (new connection)---------------> Loading
 *   LoadFailed --retry due (interval elapsed)-----------> Loading
 *   LoadFailed --retry too soon------------------------> LoadFailed
 *
 * Pure function, unit-tested without workerd (TC-27): every documented edge
 * transitions, every undocumented (state, event) combination returns the
 * state unchanged.
 */

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'load-failed'
  | 'hibernated';

/** Why a board load failed (both are LoadFailed, logged distinctly). */
export type LoadFailureReason = 'snapshot-unreadable' | 'sql-error';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failure'; reason: LoadFailureReason }
  | { type: 'update' }
  | { type: 'compaction-start' }
  | { type: 'compaction-success' }
  | { type: 'compaction-rollback' }
  | { type: 'storage-failure' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'load-retry-due' }
  | { type: 'load-retry-early' };

/** Every new room instance starts here ([*] in the design). */
export const INITIAL_ROOM_STATE: RoomState = 'loading';

/**
 * The design diagram as a lookup: (state, event type) -> next state.
 * Events with payloads (load-failure reason, quarantined count) share one
 * edge per type, so the table keys on the type alone.
 */
const EDGES: Partial<Record<RoomState, Partial<Record<RoomEvent['type'], RoomState>>>> = {
  loading: {
    'load-success': 'ready',
    'load-failure': 'load-failed',
  },
  ready: {
    update: 'ready',
    'compaction-start': 'compacting',
    'storage-failure': 'storage-failed',
    hibernate: 'hibernated',
  },
  compacting: {
    'compaction-success': 'ready',
    'compaction-rollback': 'ready',
  },
  'storage-failed': {
    wake: 'loading',
  },
  hibernated: {
    wake: 'loading',
  },
  'load-failed': {
    'load-retry-due': 'loading',
    'load-retry-early': 'load-failed',
  },
};

/**
 * Pure transition function. Undocumented (state, event) pairs return
 * `state` unchanged — the design diagram has no such edge.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  return EDGES[state]?.[event.type] ?? state;
}
