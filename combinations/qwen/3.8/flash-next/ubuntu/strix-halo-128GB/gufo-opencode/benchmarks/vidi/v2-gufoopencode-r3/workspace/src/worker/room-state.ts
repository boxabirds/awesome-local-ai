// Pure room lifecycle from the story 4 design. BoardRoom drives it with
// nextRoomState so every transition is testable without storage or sockets
// (TC-27). 'loading', 'compacting' and 'hibernated' are short-lived internal
// states; the externally meaningful RoomState contract is ready / load-failed
// / storage-failed.

export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

// Contract states (persist.room design).
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export type RoomEvent =
  // load finished with snapshot + log applied
  | { type: 'load-ok' }
  // load finished after quarantining damaged log rows
  | { type: 'load-ok-quarantined' }
  // snapshot unreadable or SQL error during load
  | { type: 'load-failed' }
  // append pushed the log past the compaction thresholds
  | { type: 'compact' }
  | { type: 'compact-ok' }
  // compaction failed; the transaction rolled back and the log is intact
  | { type: 'compact-failed' }
  // a storage insert threw while applying an update
  | { type: 'storage-error' }
  // sockets closed and the doc discarded: next connection reloads
  | { type: 'reset' }
  // no events while sockets may stay open: the runtime may evict the object
  | { type: 'hibernate' }
  // a message or new connection wakes the object
  | { type: 'wake' }
  // a client connects to a load-failed room; retryAllowed encodes whether
  // LOAD_RETRY_MIN_INTERVAL_MS has elapsed (false: stay and close 4500)
  | { type: 'connection'; retryAllowed: boolean };

// Every edge of the lifecycle diagram; any event not applicable to the
// current state leaves it unchanged (TC-27 negative cases).
export function nextRoomState(state: RoomLifecycleState, event: RoomEvent): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-ok':
        case 'load-ok-quarantined':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'compact':
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
        case 'compact-ok':
        case 'compact-failed':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'reset':
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
        case 'connection':
          return event.retryAllowed ? 'loading' : 'load-failed';
        default:
          return state;
      }
  }
}
