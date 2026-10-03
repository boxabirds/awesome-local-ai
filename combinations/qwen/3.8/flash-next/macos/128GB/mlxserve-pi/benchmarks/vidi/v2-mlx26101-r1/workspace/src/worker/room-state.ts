// The BoardRoom's lifecycle as a pure transition function, so every edge of the
// design's room state diagram can be unit-tested without a Durable Object, a
// socket or SQLite (TC-27). The room itself keeps only the subset of these states
// that it must persist between events (`ready`, `load-failed`, `storage-failed`);
// `loading`, `compacting` and `hibernated` are transient and owned here.

/**
 * Every state of the room lifecycle diagram:
 * - `loading`          the object has been constructed or woken and is reading storage.
 * - `ready`            the document is loaded and serving clients.
 * - `compacting`       the log crossed a threshold and is being folded into a snapshot.
 * - `storage-failed`   a save threw; sockets are closed, the doc is discarded.
 * - `hibernated`       no events, the runtime may evict the object (sockets stay open).
 * - `load-failed`      the saved board cannot be read; clients are refused with 4500.
 */
export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/**
 * The subset the room tracks between events. `loading` and `compacting` are
 * synchronous (they happen inside one turn), and `hibernated` is not observable
 * by the room itself, so only these three need storing.
 */
export type RoomState = Extract<
  RoomLifecycleState,
  'ready' | 'load-failed' | 'storage-failed'
>;

/** Every event that can move the room between states. */
export type RoomEvent =
  /** A load read the snapshot and log cleanly. */
  | 'load-ok'
  /** A load quarantined damaged log rows and applied the rest. */
  | 'load-quarantined'
  /** A load could not read the snapshot or hit an SQL error. */
  | 'load-error'
  /** An update was applied to the document and stored. */
  | 'update-stored'
  /** The log crossed a threshold and compaction is starting. */
  | 'compact-start'
  /** Compaction committed a new snapshot and truncated the log. */
  | 'compact-done'
  /** Compaction failed and rolled back, log and previous snapshot intact. */
  | 'compact-rollback'
  /** A storage write threw while saving an update. */
  | 'storage-error'
  /** A new connection asks a storage-failed room to reload its document. */
  | 'reload'
  /** No events for a while; the runtime may hibernate the object. */
  | 'hibernate'
  /** A message or new connection wakes a hibernated object. */
  | 'wake'
  /** A connection arrives while load-failed, after LOAD_RETRY_MIN_INTERVAL_MS. */
  | 'retry-allowed'
  /** A connection arrives while load-failed, before the interval: refused, no reload. */
  | 'retry-refused';

/**
 * The next state for `(state, event)`, mirroring the design's lifecycle diagram
 * exactly. An event that is not valid for a state leaves that state unchanged —
 * that is what makes the room's own event dispatch a no-op on a spurious event
 * rather than a silent corruption (the negative half of TC-27).
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
): RoomLifecycleState {
  switch (state) {
    case 'loading':
      switch (event) {
        case 'load-ok':
        case 'load-quarantined':
          return 'ready';
        case 'load-error':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event) {
        case 'update-stored':
          return 'ready';
        case 'compact-start':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event) {
        case 'compact-done':
        case 'compact-rollback':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event) {
        case 'reload':
          return 'loading';
        default:
          return state;
      }
    case 'hibernated':
      switch (event) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }
    case 'load-failed':
      switch (event) {
        case 'retry-allowed':
          return 'loading';
        case 'retry-refused':
          return 'load-failed';
        default:
          return state;
      }
  }
}
