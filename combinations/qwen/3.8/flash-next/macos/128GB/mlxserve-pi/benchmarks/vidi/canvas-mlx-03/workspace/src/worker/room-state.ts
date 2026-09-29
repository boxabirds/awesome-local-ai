// The BoardRoom lifecycle as a pure transition function, so every edge of the
// design's room state diagram is testable without a Durable Object runtime.
//
//   [*] -> loading : object constructed or woken
//   loading -> ready            : snapshot and log applied
//   loading -> ready            : log rows quarantined, rest applied
//   loading -> load-failed      : snapshot unreadable or SQL error
//   ready -> ready              : update applied, stored, broadcast
//   ready -> compacting         : log exceeds threshold
//   compacting -> ready         : snapshot replaced, log truncated
//   compacting -> ready         : compaction error, rolled back, log intact
//   ready -> storage-failed     : insert throws
//   storage-failed -> loading   : sockets closed, doc discarded, next connection
//   ready -> hibernated         : no events, sockets may stay open
//   hibernated -> loading       : message or new connection wakes the object
//   load-failed -> loading      : new connection after LOAD_RETRY_MIN_INTERVAL_MS
//   load-failed -> load-failed  : connection before interval, closed 4500
//
// Events that do not apply to a state leave the state unchanged (negative).

import { CLOSE_BOARD_LOAD_FAILED } from '../shared/protocol.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config.ts';

export type RoomState =
  | 'loading'
  | 'ready'
  | 'load-failed'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated';

export type RoomEvent =
  /** Construct/wake finished and the board applied completely. */
  | { type: 'load-ok' }
  /** …and some log rows had to be quarantined (still a complete-enough board). */
  | { type: 'load-ok-quarantined' }
  /** The snapshot is unreadable or a read threw. */
  | { type: 'load-failed' }
  /** A client update was applied to the in-memory doc. */
  | { type: 'update-applied' }
  /** The log crossed a compaction threshold. */
  | { type: 'log-exceeds-threshold' }
  /** A new snapshot replaced the old one and the log was truncated. */
  | { type: 'compaction-done' }
  /** Compaction failed and rolled back; the log is intact. */
  | { type: 'compaction-error' }
  /** A storage insert threw: the room can no longer promise durability. */
  | { type: 'storage-write-failed' }
  /** A client connects while the room is storage-failed: reload before serving. */
  | { type: 'reload-requested' }
  /** No events pending; sockets may stay open while the object idles. */
  | { type: 'hibernate' }
  /** A message or new connection woke a hibernated object. */
  | { type: 'wake' }
  /** A client connects to a load-failed room; elapsed = time since the failure. */
  | { type: 'load-retry'; elapsedMs: number };

export interface RoomTransition {
  state: RoomState;
  /** Close code the room must send on the connecting socket, when it has one. */
  closeCode?: number;
}

/**
 * The next room state for `state` + `event`. Pure: no I/O, no timers — callers
 * pass the measured elapsed time for the load-retry edge.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomTransition {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-ok':
        case 'load-ok-quarantined':
          return { state: 'ready' };
        case 'load-failed':
          return { state: 'load-failed' };
        default:
          return same(state);
      }
    case 'ready':
      switch (event.type) {
        // An applied, stored, broadcast change is still just a ready room.
        case 'update-applied':
          return same(state);
        case 'log-exceeds-threshold':
          return { state: 'compacting' };
        case 'storage-write-failed':
          return { state: 'storage-failed' };
        case 'hibernate':
          return { state: 'hibernated' };
        default:
          return same(state);
      }
    case 'compacting':
      switch (event.type) {
        // Success and a rolled-back failure both land back in ready: either way
        // the board is still served and the log is consistent.
        case 'compaction-done':
        case 'compaction-error':
          return { state: 'ready' };
        default:
          return same(state);
      }
    case 'storage-failed':
      // The doc was discarded; the next connection reloads from storage.
      return event.type === 'reload-requested' ? { state: 'loading' } : same(state);
    case 'hibernated':
      return event.type === 'wake' ? { state: 'loading' } : same(state);
    case 'load-failed':
      if (event.type === 'load-retry') {
        if (event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return { state: 'loading' };
        // Too soon: refuse this connection without touching storage again.
        return { state: 'load-failed', closeCode: CLOSE_BOARD_LOAD_FAILED };
      }
      return same(state);
    default:
      return same(state as never);
  }
}

function same(state: RoomState): RoomTransition {
  return { state };
}
