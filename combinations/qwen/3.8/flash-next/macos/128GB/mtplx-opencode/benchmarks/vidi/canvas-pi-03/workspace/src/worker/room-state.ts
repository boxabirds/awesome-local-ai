// Room lifecycle state machine (persist.room).
//
// Pure function over the lifecycle diagram in the story design: no I/O, no
// clock beyond an `elapsedMs` the caller passes in. BoardRoom keeps the state
// and the timestamp; every decision ("serve", "close 4500", "reload first")
// is derived from this function so the whole lifecycle is unit-testable
// (TC-27) without a Durable Object, a socket or a database.
//
//   Loading ──loaded──▶ Ready ──update-stored──▶ Ready
//   Loading ──load-failed──▶ LoadFailed
//   Ready ──compact-start──▶ Compacting ──compact-done──▶ Ready
//   Ready ──store-failed──▶ StorageFailed ──reload──▶ Loading
//   Ready ──hibernate──▶ Hibernated ──wake──▶ Loading
//   LoadFailed ──retry-load (>= LOAD_RETRY_MIN_INTERVAL_MS)──▶ Loading
//   LoadFailed ──retry-load (before that)──▶ LoadFailed   (close 4500)

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** The lifecycle states a BoardRoom (or its state machine) can be in. */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** Events the room can react to. */
export type RoomEvent =
  /** The wake-time load applied the snapshot and the log (possibly with some
   * rows quarantined). */
  | { type: 'loaded'; quarantined: number }
  /** The wake-time load could not be trusted (unreadable snapshot, or SQL
   * error on read). */
  | { type: 'load-failed' }
  /** An update was applied, stored and broadcast. */
  | { type: 'update-stored' }
  /** Compaction started (log passed a threshold). */
  | { type: 'compact-start' }
  /** Compaction finished; `ok` false means it rolled back. */
  | { type: 'compact-done'; ok: boolean }
  /** A storage write threw: the room resets (close all, discard doc). */
  | { type: 'store-failed' }
  /** A new connection arrived while storage-failed: reload before serving. */
  | { type: 'reload' }
  /** No work left; the object may hibernate. */
  | { type: 'hibernate' }
  /** A message or connection woke a hibernated object. */
  | { type: 'wake' }
  /** A connection arrived while load-failed; `elapsedMs` is the time since
   * the failure was recorded. */
  | { type: 'retry-load'; elapsedMs: number };

/**
 * The next state, or the same state when `event` does not apply to it
 * (invalid combinations leave the state untouched — the negative half of
 * TC-27).
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'loaded':
          // Quarantined rows still produce a usable board.
          return 'ready';
        case 'load-failed':
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
        case 'store-failed':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }

    case 'compacting':
      // Success truncates the log, failure rolls it back: either way the room
      // serves the board again.
      return event.type === 'compact-done' ? 'ready' : state;

    case 'storage-failed':
      // Only a reload (a new connection rebuilding the document) gets the
      // room back to serving.
      return event.type === 'reload' ? 'loading' : state;

    case 'hibernated':
      return event.type === 'wake' ? 'loading' : state;

    case 'load-failed':
      if (event.type === 'retry-load') {
        // Throttle retries: a broken board must not be re-read on every
        // reconnect attempt, but it must never be presented as empty either.
        return event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
      }
      return state;

    default:
      return state;
  }
}

/** True when a room in `state` may accept document traffic at all. */
export function canServe(state: RoomState): boolean {
  return state === 'ready' || state === 'compacting';
}
