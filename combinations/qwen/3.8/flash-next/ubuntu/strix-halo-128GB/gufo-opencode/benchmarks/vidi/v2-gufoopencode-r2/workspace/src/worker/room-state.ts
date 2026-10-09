// Pure room lifecycle state machine (persist.room). Lives in its own module
// with no cloudflare imports so it is unit-testable on the node pool.
// Invalid events leave the state unchanged.

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'load-failed'
  | 'storage-failed';

export type RoomEvent =
  | 'load-ok' // snapshot and log applied, or damaged log rows quarantined
  | 'load-failed' // snapshot unreadable or SQL error
  | 'update' // applied, stored, broadcast
  | 'compact-start' // log exceeds a threshold
  | 'compact-ok' // snapshot replaced, log truncated
  | 'compact-failed' // compaction rolled back, log intact
  | 'append-failed' // insert threw
  | 'next-connection' // storage-failed room reloads on the next connection
  | 'hibernate' // idle, no events
  | 'wake' // message or connection wakes a hibernated object
  | 'retry-allowed' // connection after LOAD_RETRY_MIN_INTERVAL_MS
  | 'retry-denied'; // connection before the interval (closed 4500)

export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event) {
        case 'load-ok':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event) {
        case 'update':
          return 'ready';
        case 'compact-start':
          return 'compacting';
        case 'append-failed':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event) {
        case 'compact-ok':
        case 'compact-failed':
          return 'ready';
        default:
          return state;
      }
    case 'hibernated':
      switch (event) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }
    case 'load-failed':
      switch (event) {
        case 'retry-allowed':
          return 'loading';
        case 'retry-denied':
          return 'load-failed';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event) {
        case 'next-connection':
          return 'loading';
        default:
          return state;
      }
  }
}
