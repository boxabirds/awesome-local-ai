/**
 * The room's life between being woken and going back to sleep.
 *
 * A room has three states the outside world can watch — `ready`, `load-failed` and
 * `storage-failed` — and the difference between the last two matters to the person
 * looking: one says "the board is unreadable, it will be tried again", the other says
 * "the board is writable but cannot be kept, so it is closed to writes".
 *
 * This module is the whole transition table, as a function of (state, event) with no
 * I/O in it, so the awkward half of the question — which events are *not* allowed to
 * move a room out of a state where moving it would lose something — can be answered
 * by a unit test instead of by an outage. `BoardRoom` keeps its state in one field
 * and changes it only through `nextRoomState`; the tests in `tests/unit/room-state.test.ts`
 * enumerate the edges of the design's diagram and forbid every other one.
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState =
  /** Awake, board not read yet: nothing is served and nothing is broadcast. */
  | 'loading'
  /** The board is in memory and matches everything that was stored. */
  | 'ready'
  /** Serving normally while the update log is folded into a new snapshot. */
  | 'compacting'
  /**
   * Asleep between invocations, sockets possibly still open. Only the very first
   * statement a cold object can make about itself: from the object's point of view
   * it was hibernated until something woke it.
   */
  | 'hibernated'
  /** An update could not be written; no further write is accepted in this object's life. */
  | 'storage-failed'
  /** The board could not be read; connections are refused with a code that says so. */
  | 'load-failed';

export type RoomEvent =
  | { type: 'loaded'; quarantined: number }
  | { type: 'load-failed' }
  /** An update was stored, applied and broadcast. */
  | { type: 'update-stored' }
  | { type: 'compaction-started' }
  | { type: 'compaction-committed' }
  | { type: 'compaction-rolled-back' }
  /** An insert threw. */
  | { type: 'storage-error' }
  | { type: 'hibernated' }
  /** A message or a new connection woke the object. */
  | { type: 'woken' }
  /** Someone arrived at a board whose load failed; the floor is the caller's problem. */
  | { type: 'retry-load'; msSinceLastAttempt: number };

/**
 * The edges of the design's state diagram, and nothing else. An event that the
 * diagram does not draw for a state returns that state unchanged: a room that
 * answered a stray event by, say, discarding its document would take the board away
 * from everyone on it.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    // Loading -> Ready: the snapshot and the log applied. A row that had to be
    // quarantined is a detail reported in the log, not a different state: the board
    // opened with everything it could read.
    case 'loaded':
      return state === 'loading' ? 'ready' : state;

    // Loading -> LoadFailed: the snapshot is unreadable, or SQL itself failed.
    case 'load-failed':
      return state === 'loading' ? 'load-failed' : state;

    // LoadFailed -> Loading: a new connection, at most once per LOAD_RETRY_MIN_INTERVAL_MS.
    case 'retry-load':
      return state === 'load-failed' && event.msSinceLastAttempt >= LOAD_RETRY_MIN_INTERVAL_MS
        ? 'loading'
        : state;

    // Hibernated -> Loading, and StorageFailed -> Loading: the next connection reads
    // the whole document again. From `load-failed` the way out is `retry-load`, which
    // is the only load event with a floor on how often it may fire.
    case 'woken':
      return state === 'hibernated' || state === 'storage-failed' ? 'loading' : state;

    // Ready -> Hibernated: nothing to do; open sockets stay open.
    case 'hibernated':
      return state === 'ready' ? 'hibernated' : state;

    // Ready -> Compacting: the log passed its threshold.
    case 'compaction-started':
      return state === 'ready' ? 'compacting' : state;

    // Compacting -> Ready, whether the new snapshot was committed or the whole
    // transaction was rolled back with the log intact.
    case 'compaction-committed':
    case 'compaction-rolled-back':
      return state === 'compacting' ? 'ready' : state;

    // Ready -> StorageFailed: an insert threw.
    case 'storage-error':
      return state === 'ready' ? 'storage-failed' : state;

    // Ready -> Ready. Storing an update is what a ready room does all day.
    case 'update-stored':
      return state;
  }
}
