// BoardRoom lifecycle state machine (story 4, persist.room): the pure
// transition function behind the design's room lifecycle diagram.
//
//   [*] --> Loading            : object constructed or woken
//   Loading --> Ready          : snapshot and log applied (clean or with
//                                quarantined rows — both land on Ready)
//   Loading --> LoadFailed     : snapshot unreadable or SQL error
//   Ready --> Ready            : update applied, stored, broadcast
//   Ready --> Compacting       : log exceeds a threshold
//   Compacting --> Ready       : snapshot replaced, log truncated
//   Compacting --> Ready       : compaction error rolled back, log intact
//   Ready --> StorageFailed    : insert threw
//   StorageFailed --> Loading  : sockets closed, doc discarded, next
//                                connection
//   Ready --> Hibernated       : no events, sockets may stay open
//   Hibernated --> Loading     : a message or new connection wakes the object
//   LoadFailed --> Loading     : new connection after LOAD_RETRY_MIN_INTERVAL_MS
//   LoadFailed --> LoadFailed  : connection before the interval (closed 4500)
//
// Events that are not valid edges for a state leave the state unchanged.

export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  | 'load-ok'
  | 'load-failed'
  | 'update-stored'
  | 'compaction-start'
  | 'compaction-done'
  | 'compaction-rolled-back'
  | 'insert-threw'
  | 'doc-discarded'
  | 'hibernate'
  | 'wake'
  | /** A new connection hit a load-failed room. */
    { kind: 'connection'; elapsedMs: number; minIntervalMs: number };

export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
): RoomLifecycleState {
  if (typeof event === 'object') {
    // Only load-failed rooms gate a connection on the retry interval.
    if (state === 'load-failed') {
      return event.elapsedMs >= event.minIntervalMs ? 'loading' : 'load-failed';
    }
    return state;
  }
  switch (state) {
    case 'loading':
      if (event === 'load-ok') return 'ready';
      if (event === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event === 'update-stored') return 'ready';
      if (event === 'compaction-start') return 'compacting';
      if (event === 'insert-threw') return 'storage-failed';
      if (event === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event === 'compaction-done' || event === 'compaction-rolled-back') {
        return 'ready';
      }
      return state;
    case 'storage-failed':
      if (event === 'doc-discarded') return 'loading';
      return state;
    case 'hibernated':
      if (event === 'wake') return 'loading';
      return state;
    case 'load-failed':
      return state;
  }
}
