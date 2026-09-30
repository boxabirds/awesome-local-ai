// The board room's lifecycle as a pure transition function, so every edge of the
// design's room state diagram is testable without a Durable Object, a socket or
// SQLite. The room keeps one of these values and asks it what comes next; an
// event that has no edge out of the current state changes nothing (a room never
// jumps to a state the diagram does not allow).
//
//   [*] -> loading : object constructed or woken
//   loading -> ready : snapshot and log applied (also: log rows quarantined, rest applied)
//   loading -> load-failed : snapshot unreadable or SQL error
//   ready -> ready : update applied, stored, broadcast
//   ready -> compacting : log exceeds a compaction threshold
//   compacting -> ready : snapshot replaced, log truncated
//   compacting -> ready : compaction error rolled back, log intact
//   ready -> storage-failed : an append threw
//   storage-failed -> loading : sockets closed (1011), doc discarded, next connection
//   ready -> hibernated : no events, sockets may stay open
//   hibernated -> loading : a message or a new connection wakes the object
//   load-failed -> loading : a new connection arrives after LOAD_RETRY_MIN_INTERVAL_MS
//   load-failed -> load-failed : a connection arrives before that interval (closed 4500)

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'load-failed'
  | 'storage-failed';

export type RoomEvent =
  /** Storage load finished and the document is servable. */
  | { type: 'loaded' }
  /** Storage load failed: an unreadable snapshot or a SQL error. */
  | { type: 'load-failed' }
  /** An update was applied, stored and broadcast. */
  | { type: 'update-stored' }
  /** The log crossed a compaction threshold, so compaction starts. */
  | { type: 'log-exceeds-threshold' }
  /** The new snapshot is committed and the log is truncated. */
  | { type: 'compacted' }
  /** Compaction failed, rolled back; the log is intact. */
  | { type: 'compaction-failed' }
  /** A storage write threw: the room can no longer promise saving. */
  | { type: 'storage-error' }
  /** A client connected (the only thing that can restart a failed room). */
  | { type: 'client-connected' }
  /** The object went idle with hibernated sockets. */
  | { type: 'hibernated' }
  /** A message or connection woke the hibernated object. */
  | { type: 'woken' }
  /**
   * A connection arrived at a load-failed room `elapsedMs` after the failure.
   * Loading is retried only once the retry interval has passed; before that the
   * room stays broken and the socket is closed with CLOSE_BOARD_LOAD_FAILED.
   */
  | { type: 'load-retry'; elapsedMs: number };

/** The states a room can serve clients from (today: only `ready`). */
export function isServing(state: RoomState): boolean {
  return state === 'ready';
}

/** Whether a load-failed room may retry now. */
export function mayRetryLoad(elapsedMs: number): boolean {
  return elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS;
}

/** The next state for a state/event pair; unchanged when the diagram has no edge. */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'update-stored') return 'ready';
      if (event.type === 'log-exceeds-threshold') return 'compacting';
      if (event.type === 'storage-error') return 'storage-failed';
      if (event.type === 'hibernated') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compacted') return 'ready';
      if (event.type === 'compaction-failed') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'client-connected') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'woken') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'load-retry') return mayRetryLoad(event.elapsedMs) ? 'loading' : 'load-failed';
      return state;
  }
}
