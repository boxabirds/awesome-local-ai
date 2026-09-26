// Story 4, design "room lifecycle": the room's lifecycle states and the pure
// transition function that drives them (the design's state diagram, verbatim):
//
//   [*] --> Loading : object constructed or woken
//   Loading --> Ready : snapshot and log applied
//   Loading --> Ready : log rows quarantined rest applied
//   Loading --> LoadFailed : snapshot unreadable or SQL error
//   Ready --> Ready : update applied stored broadcast
//   Ready --> Compacting : log exceeds threshold
//   Compacting --> Ready : snapshot replaced log truncated
//   Compacting --> Ready : compaction error rolled back log intact
//   Ready --> StorageFailed : insert throws
//   StorageFailed --> Loading : sockets closed doc discarded next connection
//   Ready --> Hibernated : no events sockets may stay open
//   Hibernated --> Loading : message or new connection wakes object
//   LoadFailed --> Loading : new connection after LOAD_RETRY_MIN_INTERVAL_MS
//   LoadFailed --> LoadFailed : connection before interval closed 4500
//
// Notes:
//  - BOTH load failure kinds (unreadable snapshot, SQL error on read) end in
//    LoadFailed: the client is closed with 4500 and the load is retried on a
//    new connection at most every LOAD_RETRY_MIN_INTERVAL_MS (TC-26).
//  - StorageFailed is reached only from Ready (an INSERT threw); every next
//    connection reloads (TC-14/TC-15).
//  - Events that have no edge from the current state leave it unchanged
//    (e.g. loads block events, compaction is synchronous).

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomLifecycle =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed'; reason: string }
  | { type: 'update-applied' }
  | { type: 'log-exceeds-threshold' }
  | { type: 'compaction-committed' }
  | { type: 'compaction-rolled-back' }
  | { type: 'insert-throws' }
  | { type: 'next-connection' }
  | { type: 'wake' }
  | { type: 'hibernate' }
  | { type: 'connection-attempt'; elapsedMs: number };

/**
 * The one and only transition function for the room lifecycle.
 *
 * `event.elapsedMs` (connection-attempt) is the time since the room entered
 * the failed state; the interval is read from the shared config here so the
 * machine and the room can never disagree about it.
 */
export function nextRoomState(
  current: RoomLifecycle,
  event: RoomEvent
): RoomLifecycle {
  switch (current) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return 'ready';
        case 'load-failed': // snapshot unreadable OR SQL error
          return 'load-failed';
        default:
          // Loads block events; nothing else is observable while loading.
          return current;
      }
    case 'ready':
      switch (event.type) {
        case 'update-applied':
          return 'ready';
        case 'log-exceeds-threshold':
          return 'compacting';
        case 'insert-throws':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return current;
      }
    case 'compacting':
      switch (event.type) {
        case 'compaction-committed':
        case 'compaction-rolled-back':
          return 'ready';
        default:
          // Compaction is synchronous; no other event can interleave.
          return current;
      }
    case 'storage-failed':
      // Sockets are closed and the doc discarded; the next connection
      // rebuilds from storage (no minimum interval).
      if (event.type === 'next-connection') {
        return 'loading';
      }
      return current;
    case 'hibernated':
      // A message or a new connection wakes the object: reconstruct + load.
      if (event.type === 'wake' || event.type === 'next-connection') {
        return 'loading';
      }
      return current;
    case 'load-failed':
      // A connection within the retry interval is closed with 4500 and the
      // state is unchanged; at/after the interval a retry load starts.
      if (event.type === 'connection-attempt') {
        return event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
      }
      return current;
  }
}
