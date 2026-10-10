/**
 * The lifecycle of one board's room (persist.room), as a pure transition
 * function so every edge of the design's state diagram can be tested without
 * a Durable Object, a socket or a disk.
 *
 * ```text
 * loading ──loaded──▶ ready            loading ──load-failed──▶ load-failed
 * loading ──loaded-damaged──▶ ready    load-failed ──connection(retry)──▶ loading
 * ready ──update──▶ ready              ready ──compacting──▶ compacting ──compacted/failed──▶ ready
 * ready ──storage-failed──▶ storage-failed ──reload──▶ loading
 * ready ──idle──▶ hibernated ──woken──▶ loading
 * ```
 */

/** Where the room is in its life. `compacting` and `hibernated` are transient
 * phases the room never serves from; `RoomState` is what a client may meet. */
export type RoomPhase =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'load-failed'
  | 'storage-failed'
  | 'hibernated';

/** The three phases a socket can be answered in (the design's `RoomState`). */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/**
 * Everything that can happen to a room. `connection` carries whether the retry
 * interval has passed (`LOAD_RETRY_MIN_INTERVAL_MS`); `loaded-damaged` is the
 * edge where some log rows were quarantined and the rest applied.
 */
export type RoomEvent =
  | { readonly type: 'loaded' }
  | { readonly type: 'loaded-damaged' }
  | { readonly type: 'load-failed' }
  | { readonly type: 'update' }
  | { readonly type: 'compacting' }
  | { readonly type: 'compacted' }
  | { readonly type: 'compaction-failed' }
  | { readonly type: 'storage-failed' }
  | { readonly type: 'reload' }
  | { readonly type: 'idle' }
  | { readonly type: 'woken' }
  | { readonly type: 'connection'; readonly retryAllowed: boolean };

/** The room's initial phase: nothing is known until the board has been read. */
export const INITIAL_ROOM_PHASE: RoomPhase = 'loading';

/**
 * One step of the diagram. A pair that is not drawn there is not allowed, and
 * leaves the phase unchanged — a room does not get out of `load-failed` by
 * anything other than a connection that is allowed to retry.
 */
export function nextRoomState(phase: RoomPhase, event: RoomEvent): RoomPhase {
  switch (phase) {
    case 'loading':
      switch (event.type) {
        case 'loaded':
        case 'loaded-damaged':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return phase;
      }
    case 'ready':
      switch (event.type) {
        // A change does not move the room anywhere; it is stored and broadcast.
        case 'update':
          return 'ready';
        case 'compacting':
          return 'compacting';
        case 'storage-failed':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return phase;
      }
    case 'compacting':
      // Whether the fold worked or was rolled back, the room serves the same
      // board either way - the log is still there.
      return event.type === 'compacted' || event.type === 'compaction-failed' ? 'ready' : phase;
    case 'load-failed':
      // The only way out is a connection that is allowed to try again, which
      // is what keeps a broken board from being read over and over.
      return event.type === 'connection' && event.retryAllowed ? 'loading' : phase;
    case 'storage-failed':
      return event.type === 'reload' ? 'loading' : phase;
    case 'hibernated':
      return event.type === 'woken' ? 'loading' : phase;
  }
}

/**
 * What a socket should be told, given where the room is. `loading` means the
 * room does not know yet: it is neither serving nor refusing.
 */
export function roomGate(phase: RoomPhase): RoomState | 'loading' {
  switch (phase) {
    case 'ready':
    case 'compacting':
      return 'ready';
    case 'load-failed':
      return 'load-failed';
    case 'storage-failed':
      return 'storage-failed';
    // A room that has not read the board yet, or has not been woken up, knows
    // nothing; it is neither serving nor refusing.
    case 'loading':
    case 'hibernated':
      return 'loading';
  }
}
