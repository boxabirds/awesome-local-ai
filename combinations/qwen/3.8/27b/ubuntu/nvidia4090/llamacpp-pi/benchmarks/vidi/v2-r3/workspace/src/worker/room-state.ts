/**
 * Pure room lifecycle state machine (story 4, persist.room).
 *
 * Models every edge of the design's room lifecycle diagram so the room's
 * transitions are unit-testable (TC-27) and invalid events are impossible to
 * introduce silently. The Durable Object itself only ever sits in the
 * states it can observe while awake (loading, ready, compacting,
 * storage-failed, load-failed): a running object cannot observe its own
 * hibernation — in production the wake re-runs the constructor, which
 * starts at 'loading' again.
 *
 * `connection` carries the timing comparison as plain numbers so this
 * module stays free of Date.now() and stays pure.
 */

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type LoadFailedReason = 'snapshot-unreadable' | 'sql-error';

export type RoomEvent =
  /** The snapshot (if any) and the update log applied. */
  | { type: 'load-succeeded'; quarantined: number }
  /** The snapshot is unreadable or SQL itself failed while loading. */
  | { type: 'load-failed'; reason: LoadFailedReason }
  /** An update was applied, stored and broadcast (self-loop). */
  | { type: 'update-applied' }
  /** The log crossed the compaction threshold. */
  | { type: 'compaction-start' }
  /** The new snapshot replaced the log (transaction committed). */
  | { type: 'compaction-commit' }
  /** Compaction threw; the transaction rolled back, the log is intact. */
  | { type: 'compaction-rollback' }
  /** store.append threw: sockets are closed, the doc is discarded. */
  | { type: 'storage-write-failed' }
  /** The next connection asks a storage-failed room to load again. */
  | { type: 'reload-requested' }
  /** No events and no open sockets: the runtime may hibernate. */
  | { type: 'hibernate' }
  /** A message or a new connection woke a hibernated object. */
  | { type: 'wake' }
  /**
   * A new connection while load-failed. Moves to 'loading' (retry the
   * load) only once retryIntervalMs has elapsed since the failed load;
   * before that the room closes the socket with CLOSE_BOARD_LOAD_FAILED
   * and the state is unchanged.
   */
  | { type: 'connection'; elapsedMs: number; retryIntervalMs: number };

export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      if (event.type === 'load-succeeded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'update-applied') return 'ready';
      if (event.type === 'compaction-start') return 'compacting';
      if (event.type === 'storage-write-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compaction-commit' || event.type === 'compaction-rollback') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'reload-requested') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'connection' && event.elapsedMs >= event.retryIntervalMs) return 'loading';
      return state;
  }
}
