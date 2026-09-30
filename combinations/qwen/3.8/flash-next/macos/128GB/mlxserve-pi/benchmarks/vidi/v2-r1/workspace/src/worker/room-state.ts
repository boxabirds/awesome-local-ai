import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * The states a board room is in *between* invocations: kept in memory, rebuilt
 * from storage after hibernation. Transient phases a load or a compaction
 * occupies are part of the same machine because the room can be woken or closed
 * in the middle of one.
 *
 * @see spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/design.md
 */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/** {@link RoomState} plus the transient phases of loading and compaction. */
export type RoomPhase = RoomState | 'loading' | 'compacting' | 'hibernated';

/**
 * Everything that moves the room between states. `connection` carries the time
 * since the load failed, because a room in LoadFailed must not retry the load
 * more often than LOAD_RETRY_MIN_INTERVAL_MS.
 */
export type RoomEvent =
  | { type: 'construct' }
  | { type: 'start-load' }
  | { type: 'load-ok' }
  | { type: 'load-ok-quarantined' }
  | { type: 'load-failed' }
  | { type: 'update-applied' }
  | { type: 'compaction-due' }
  | { type: 'compaction-done' }
  | { type: 'compaction-failed' }
  | { type: 'storage-write-failed' }
  | { type: 'connection'; msSinceLoadFailed: number }
  | { type: 'hibernate' }
  | { type: 'wake' };

/** Whether a room in LoadFailed may attempt the load again. */
export function loadRetryAllowed(msSinceLoadFailed: number): boolean {
  return msSinceLoadFailed >= LOAD_RETRY_MIN_INTERVAL_MS;
}

/**
 * The transition function of design.md's stateDiagram-v2. An event with no edge
 * out of the current state leaves the state unchanged: a late or spurious event
 * must never move the room into a state the board is not in.
 */
export function nextRoomState(state: RoomPhase, event: RoomEvent): RoomPhase {
  switch (state) {
    case 'loading':
      // Everything the load can find, and nothing else: a board is built from
      // what storage holds.
      if (event.type === 'load-ok' || event.type === 'load-ok-quarantined') {
        return 'ready';
      }
      if (event.type === 'load-failed') return 'load-failed';
      // A wake or a construction while still loading is the same load.
      if (event.type === 'construct' || event.type === 'wake' || event.type === 'start-load') {
        return 'loading';
      }
      return state;

    case 'ready':
      // The path every change takes: applied, stored, broadcast, still ready.
      if (event.type === 'update-applied') return 'ready';
      if (event.type === 'connection') return 'ready';
      if (event.type === 'compaction-due') return 'compacting';
      if (event.type === 'storage-write-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      if (event.type === 'construct') return 'loading';
      // Reading the board again inside the same wake is going back through
      // Loading to get to LoadFailed: design.md's diagram reaches LoadFailed from
      // Loading only, and production reads the board on a construct or a
      // connection and nowhere else.
      if (event.type === 'start-load') return 'loading';
      return state;

    case 'compacting':
      // Both outcomes end in Ready: either the snapshot was replaced and the log
      // truncated, or the transaction rolled back and the log is intact.
      if (event.type === 'compaction-done' || event.type === 'compaction-failed') {
        return 'ready';
      }
      return state;

    case 'storage-failed':
      // The room closed its sockets and discarded its memory; it does not retry
      // saving on a timer, it waits for somebody to come back.
      if (
        event.type === 'connection' ||
        event.type === 'construct' ||
        event.type === 'start-load'
      ) {
        return 'loading';
      }
      return state;

    case 'hibernated':
      // A message or a new connection wakes the object, and waking rebuilds the
      // document out of storage.
      if (
        event.type === 'wake' ||
        event.type === 'connection' ||
        event.type === 'construct' ||
        event.type === 'start-load'
      ) {
        return 'loading';
      }
      return state;

    case 'load-failed':
      // LoadFailed -> Loading: a new connection, but not more often than the
      // retry interval. Before it, the same connection is refused again.
      if (
        (event.type === 'connection' && loadRetryAllowed(event.msSinceLoadFailed)) ||
        event.type === 'start-load'
      ) {
        return 'loading';
      }
      if (event.type === 'construct' || event.type === 'wake') return 'loading';
      return state;
  }
}
