/**
 * The board room's lifecycle as a pure state machine (design "Persistent,
 * hibernating board room": room lifecycle diagram).
 *
 * Only the *transitions* live here, so every edge of that diagram — and every
 * event that must *not* move the room — is testable without a Durable Object, a
 * socket or a database. `board-room.ts` decides when an event happens (it owns
 * the clock and the storage); this module says only what happens next.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config.js';

/** The room's lifecycle, one state per node of the design's diagram. */
export type RoomLifecycleState =
  /** Constructed or woken; nothing is served until the load has been tried. */
  | 'loading'
  /** The board is in memory and storage is writable: the normal state. */
  | 'ready'
  /** Folding the update log into a snapshot; still serving normally. */
  | 'compacting'
  /** A write failed. The doc is discarded and every socket closed. */
  | 'storage-failed'
  /** No events pending. Sockets may stay open; no compute is held. */
  | 'hibernated'
  /** The board could not be read. The room refuses to serve an empty doc. */
  | 'load-failed';

/**
 * What can happen to a room. `msSinceFailure` is how long ago the load that
 * failed happened, so the retry rule is part of the machine rather than an
 * `if` in the middle of the room; `quarantined` says how many damaged rows the
 * load set aside and changes nothing about the transition — it is there so the
 * room's "loaded, with damage" edge is expressible.
 */
export type RoomEvent =
  /** The object was constructed, or woken to run its load. */
  | { type: 'constructed' }
  /** The snapshot and the log were applied. */
  | { type: 'loaded'; quarantined: number }
  /** The snapshot could not be read, or the read itself failed. */
  | { type: 'load-failed' }
  /** An update was applied, written and broadcast. */
  | { type: 'stored' }
  /** The log passed its threshold and is being folded into a snapshot. */
  | { type: 'compaction-start' }
  /** The snapshot was replaced and the log truncated. */
  | { type: 'compacted' }
  /** Compaction threw; it was rolled back and the log is intact. */
  | { type: 'compaction-failed' }
  /** An insert threw: the change was not broadcast to anybody. */
  | { type: 'append-failed' }
  /** Nothing left to do; the object may be evicted while sockets stay open. */
  | { type: 'hibernated' }
  /** A message or a new connection woke a hibernated object. */
  | { type: 'woken' }
  /** Somebody connected to a room whose last load failed. */
  | { type: 'connection'; msSinceFailure: number }
  /** Somebody connected to a room that failed to *write*: load it again. */
  | { type: 'retry-load' };

/**
 * What a client is told about. The room has six lifecycle states but a socket
 * only ever needs three answers: serve it, say the board could not be loaded,
 * or say the board could not be saved. `loading`, `compacting` and `hibernated`
 * all answer "serve it" — a message cannot arrive while the room is `loading`,
 * because the load runs inside `blockConcurrencyWhile`, and `compacting` is a
 * synchronous stretch of the same turn as the write that triggered it.
 */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/** The wire-facing state of a room in `state`. */
export function wireStateOf(state: RoomLifecycleState): RoomState {
  if (state === 'load-failed') return 'load-failed';
  if (state === 'storage-failed') return 'storage-failed';
  return 'ready';
}

/**
 * What a room is, as data: the lifecycle it is in, what a client would be told,
 * and how much of the board its storage holds. The integration tests read it
 * through `runInDurableObject` and the test-only `/__test/boards/:id/*` routes
 * answer with it, so both ask the same question in the same words and neither has
 * to reach into the object.
 */
export type RoomDebugState = {
  lifecycle: RoomLifecycleState;
  /** What a client on a socket of this room is told. */
  state: RoomState;
  /** Whether this object is holding a board in memory. */
  hasDocument: boolean;
  /** Sockets the runtime is holding for this object. */
  clients: number;
  updateRows: number;
  updateBytes: number;
  chunkRows: number;
  quarantinedRows: number;
  /** Rows the last successful load had to set aside. */
  loadedQuarantined: number;
};

/**
 * The next state, or the same state for an event that does not apply to it.
 * Every edge of the design's diagram, and nothing else:
 *
 * ```text
 * loading        --loaded-->            ready
 * loading        --loaded (quarantined)--> ready
 * loading        --load-failed-->        load-failed
 * ready          --stored-->             ready
 * ready          --compaction-start-->   compacting
 * compacting     --compacted-->          ready
 * compacting     --compaction-failed-->  ready   (rolled back, log intact)
 * ready          --append-failed-->      storage-failed
 * storage-failed --retry-load-->         loading
 * ready          --hibernated-->         hibernated
 * hibernated     --woken-->              loading
 * load-failed    --connection (>= LOAD_RETRY_MIN_INTERVAL_MS)--> loading
 * load-failed    --connection (younger than that)--> load-failed  (close 4500)
 * ```
 *
 * Anything else — a `loaded` in `ready`, a `compacted` in `loading`, a `woken`
 * in `ready` — leaves the state where it was. A state machine that ignored an
 * impossible event silently would be a machine whose states mean nothing.
 */
export function nextRoomState(state: RoomLifecycleState, event: RoomEvent): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'loaded':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'stored':
          return 'ready';
        case 'compaction-start':
          return 'compacting';
        case 'append-failed':
          return 'storage-failed';
        case 'hibernated':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      // Both outcomes land back in `ready`: a rolled-back compaction leaves the
      // log intact and the board still open.
      switch (event.type) {
        case 'compacted':
        case 'compaction-failed':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      return event.type === 'retry-load' ? 'loading' : state;
    case 'hibernated':
      return event.type === 'woken' ? 'loading' : state;
    case 'load-failed':
      if (event.type !== 'connection') return state;
      // The room retries, but not more often than once per retry interval: a
      // broken board must not cost a full storage read per reconnect.
      return event.msSinceFailure >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : state;
  }
}
