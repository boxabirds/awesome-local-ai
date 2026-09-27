// BoardRoom lifecycle state machine (see spec: persist.room state diagram).
//
// Pure transition function `nextRoomState(state, event)` so the lifecycle can
// be exhaustively tested without a Durable Object (TC-27). The room fires
// these events as it observes load results, append failures, compaction
// start/finish, hibernation wakes and load-retry connections.
//
// "Invalid" events for a state leave the state unchanged (negative cases).

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** Full room lifecycle states (design state diagram). */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'load-failed'
  | 'storage-failed';

/** Events the room can observe. */
export type RoomEvent =
  /** Load finished: snapshot (+ surviving log rows) applied. */
  | { type: 'load-ok' }
  /** Load finished: snapshot unreadable or SQL error. */
  | { type: 'load-failed' }
  /** Compaction started (threshold reached). */
  | { type: 'compact-start' }
  /** Compaction committed: snapshot replaced, log truncated. */
  | { type: 'compact-done' }
  /** Compaction rolled back: previous snapshot and log intact. */
  | { type: 'compact-rollback' }
  /** An insert threw: doc discarded, sockets closed 1011. */
  | { type: 'append-failed' }
  /** The object hibernated (no events; sockets may stay open). */
  | { type: 'hibernate' }
  /** A message or new connection woke the object: reload from storage. */
  | { type: 'wake' }
  /**
   * A new connection reached a load-failed room. `elapsedMs` is the time
   * since the load failed; the room reloads only once the minimum interval
   * has passed, otherwise it stays load-failed and closes the socket 4500.
   */
  | { type: 'retry-load'; elapsedMs: number };

/**
 * Pure transition for the room lifecycle. Every edge of the design diagram
 * is covered by TC-27; invalid events leave the state unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      if (event.type === 'load-ok') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-rollback') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'wake') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'retry-load' && event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) {
        return 'loading';
      }
      return state;
    default:
      return state;
  }
}
