import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * The BoardRoom lifecycle (story 4 design, "State diagrams") as one pure
 * transition function, so every edge of the diagram is testable without a
 * Durable Object, storage or a socket.
 *
 * `loading` and `compacting` are transient: input is gated while the object is
 * in them. `hibernated` is only reached by the platform (no events, sockets may
 * stay open); a wake constructs a fresh object, which starts in `loading`.
 *
 * `ready`, `load-failed` and `storage-failed` are the states the socket layer
 * acts on: serve, close 4500 and close 1011 respectively.
 */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  /** The object was woken by a message while it held nothing in memory. */
  | { type: 'woken' }
  /** Snapshot and log applied; `quarantined` counts damaged log rows. */
  | { type: 'load-succeeded'; quarantined?: number }
  /** The snapshot is unreadable or the SQL read itself failed. */
  | { type: 'load-failed' }
  /** A client connected; `sinceFailureMs` is time since the last load failure. */
  | { type: 'client-connected'; sinceFailureMs: number }
  /** An update was applied, stored and broadcast. */
  | { type: 'update-stored' }
  /** The log passed a compaction threshold. */
  | { type: 'compaction-started' }
  /** Compaction committed, or failed and rolled back: either way the board is intact. */
  | { type: 'compaction-finished'; rolledBack?: boolean }
  /** A storage write threw: the room resets, its sockets close with 1011. */
  | { type: 'storage-write-failed' }
  /** Sockets closed and the doc discarded; the next connection reloads. */
  | { type: 'reset-for-reload' }
  /** No events for a while; the platform may hibernate the object. */
  | { type: 'idle' };

/** A freshly constructed (or woken) object always starts by loading. */
export function initialRoomState(): RoomState {
  return 'loading';
}

/**
 * The next state for `state` given `event`. An event that means nothing in the
 * given state leaves it unchanged — the room never jumps to a state it has no
 * reason to be in.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-succeeded':
          // Damaged log rows are quarantined during load, not fatal: the rest
          // of the board is intact (PRD persist.partial_damage).
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update-stored':
        case 'client-connected':
          return 'ready';
        case 'compaction-started':
          return 'compacting';
        case 'storage-write-failed':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      // Success and a rolled-back failure both leave the board readable.
      return event.type === 'compaction-finished' ? 'ready' : state;
    case 'storage-failed':
      return event.type === 'reset-for-reload' ? 'loading' : state;
    case 'hibernated':
      return event.type === 'woken' ? 'loading' : state;
    case 'load-failed':
      // Retry at most once per LOAD_RETRY_MIN_INTERVAL_MS; every connection
      // inside the window is refused without touching storage.
      return event.type === 'client-connected' && event.sinceFailureMs >= LOAD_RETRY_MIN_INTERVAL_MS
        ? 'loading'
        : state;
  }
}

/** True when the room refuses connections because its saved state is unreadable. */
export function roomRefusesClients(state: RoomState): boolean {
  return state === 'load-failed';
}
