/**
 * Story 4 · room lifecycle state machine (design "State diagrams" — Room
 * lifecycle).
 *
 * A pure function modelling the `BoardRoom` lifecycle as a finite state
 * machine, with no I/O and no timers, so every edge of the diagram can be
 * unit-tested (TC-27). `BoardRoom` keeps a `state` field and moves it through
 * this function, so the running room and the diagram cannot drift apart.
 *
 * The load-retry *timing* is not modelled as a clock: the caller decides
 * whether enough time has passed and reports it as either `retry-load` (after
 * `LOAD_RETRY_MIN_INTERVAL_MS`, so the room may try again) or
 * `retry-load-early` (before the interval: the client is closed with 4500 and
 * no reload is attempted).
 */

export type RoomState =
  | 'hibernated'
  | 'loading'
  | 'ready'
  | 'load-failed'
  | 'compacting'
  | 'storage-failed';

export type RoomEvent =
  /** Snapshot and log applied (or everything quarantined). */
  | 'load-success'
  /** Log rows quarantined, the rest applied. */
  | 'load-quarantined'
  /** Snapshot unreadable or a SQL error. */
  | 'load-failed'
  /** An update was applied, stored and broadcast. */
  | 'update'
  /** The log exceeded a compaction threshold. */
  | 'compact-start'
  /** Snapshot replaced, log truncated. */
  | 'compact-done'
  /** Compaction failed and rolled back; the log is intact. */
  | 'compact-error'
  /** An insert threw. */
  | 'storage-error'
  /** Idle with no events; sockets may stay open. */
  | 'idle'
  /** A message or a new connection woke the object. */
  | 'wake'
  /** A connection after LOAD_RETRY_MIN_INTERVAL_MS. */
  | 'retry-load'
  /** A connection before the interval (close 4500, no reload). */
  | 'retry-load-early';

/**
 * Return the next state for `(state, event)`. Any event that the diagram does
 * not define for a state leaves it unchanged — that is the negative half of
 * TC-27.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'hibernated':
      // Hibernated → Loading on a message or a new connection.
      return event === 'wake' ? 'loading' : state;

    case 'loading':
      switch (event) {
        case 'load-success':
        case 'load-quarantined':
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
        case 'storage-error':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return state;
      }

    case 'compacting':
      // Both compaction outcomes land back in Ready (a failure rolled the
      // transaction back, so the log is intact).
      switch (event) {
        case 'compact-done':
        case 'compact-error':
          return 'ready';
        default:
          return state;
      }

    case 'storage-failed':
      // The next connection reloads (the doc was discarded).
      return event === 'wake' ? 'loading' : state;

    case 'load-failed':
      switch (event) {
        case 'retry-load':
          return 'loading';
        case 'retry-load-early':
          return 'load-failed';
        default:
          return state;
      }
  }
  return state;
}

/** What close code (if any) a client gets for a state that cannot serve it. */
export function closeCodeForState(state: RoomState): number | null {
  switch (state) {
    case 'load-failed':
      return 4500;
    case 'storage-failed':
      return 1011;
    default:
      return null;
  }
}