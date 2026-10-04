/**
 * Pure state machine for the board room lifecycle (persist.room).
 *
 * The room's observable contract states are 'ready', 'load-failed' and
 * 'storage-failed'; 'loading', 'compacting' and 'hibernated' are transient
 * states of the same diagram (the runtime owns hibernation itself — a hibernated
 * object simply re-runs its constructor, i.e. enters 'loading', on wake).
 */

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'load-failed'
  | 'storage-failed';

export type RoomEvent =
  /** Snapshot and log applied (quarantined rows aside). */
  | { type: 'load-success'; quarantined: number }
  /** Snapshot unreadable or SQL error during load. */
  | { type: 'load-failure' }
  /** An update was applied, stored and broadcast. */
  | { type: 'update-stored' }
  /** The log exceeded the compaction thresholds. */
  | { type: 'compact-start' }
  /** Snapshot replaced, log truncated. */
  | { type: 'compact-success' }
  /** Compaction error: transaction rolled back, log intact. */
  | { type: 'compact-failure' }
  /** An insert threw: sockets closed with 1011, doc discarded. */
  | { type: 'storage-failure' }
  /** Next connection after a storage failure: reload from storage. */
  | { type: 'reload-request' }
  /** No events; the runtime may hibernate the object (sockets stay open). */
  | { type: 'hibernate' }
  /** A message or new connection woke the hibernated object. */
  | { type: 'wake' }
  /** New connection after LOAD_RETRY_MIN_INTERVAL_MS: try loading again. */
  | { type: 'retry-load' }
  /** Connection before the retry interval: closed with 4500, no reload. */
  | { type: 'retry-rejected' };

export const ROOM_STATES: readonly RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'load-failed',
  'storage-failed',
];

export const ROOM_EVENTS: readonly RoomEvent['type'][] = [
  'load-success',
  'load-failure',
  'update-stored',
  'compact-start',
  'compact-success',
  'compact-failure',
  'storage-failure',
  'reload-request',
  'hibernate',
  'wake',
  'retry-load',
  'retry-rejected',
];

/**
 * Next room state after `event`. Invalid events for a state leave it
 * unchanged (the room ignores them).
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return 'ready';
        case 'load-failure':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update-stored':
          return 'ready';
        case 'compact-start':
          return 'compacting';
        case 'storage-failure':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compact-success':
        case 'compact-failure':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'reload-request':
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
        case 'retry-load':
          return 'loading';
        case 'retry-rejected':
          return 'load-failed';
        default:
          return state;
      }
    default:
      return state;
  }
}
