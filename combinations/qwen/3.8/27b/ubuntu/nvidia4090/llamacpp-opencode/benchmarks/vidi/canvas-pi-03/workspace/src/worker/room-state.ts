import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '@/shared/protocol';

/**
 * Room lifecycle states (story 4 design diagram).
 *
 *  - 'loading'        object constructed or woken; loading snapshot + log
 *  - 'ready'          doc loaded; accepting and persisting updates
 *  - 'compacting'     snapshot replacement in flight (transient; the SQL
 *                     transaction is synchronous, so it is never observed
 *                     from another call)
 *  - 'storage-failed' an insert threw; the doc was discarded and all sockets
 *                     closed; the next connection reloads from storage
 *  - 'hibernated'     no events pending; sockets may stay open (the runtime
 *                     owns this state — it re-runs the constructor on wake)
 *  - 'load-failed'    persisted state unreadable; connections are closed
 *                     with CLOSE_BOARD_LOAD_FAILED until a retry succeeds
 */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** Events of the room lifecycle diagram, one per edge. */
export type RoomEvent =
  /** Snapshot and log applied (the quarantined form carries the count). */
  | { type: 'load-succeeded'; quarantined?: number }
  /** Snapshot unreadable or a SQL error while loading. */
  | { type: 'load-failed' }
  /** Ready: an update was applied, stored and broadcast. Stays ready. */
  | { type: 'append-ok' }
  /** Ready: the insert threw. -> storage-failed. */
  | { type: 'append-failed' }
  /** Ready: the log exceeded a compaction threshold. -> compacting. */
  | { type: 'compaction-start' }
  /** Compacting: snapshot replaced, log truncated. -> ready. */
  | { type: 'compaction-success' }
  /** Compacting: the transaction threw and rolled back, log intact. -> ready. */
  | { type: 'compaction-rollback' }
  /** Storage-failed: sockets closed, doc discarded; a new connection arrives. */
  | { type: 'next-connection' }
  /** Ready: no events pending (the runtime may hibernate the object). */
  | { type: 'hibernate' }
  /** Hibernated: a message or new connection wakes the object. */
  | { type: 'wake' }
  /**
   * A new connection while load-failed. `now` and `lastLoadAttempt` decide
   * whether the retry interval has elapsed (Loading) or not (stays
   * LoadFailed and the connection is closed with CLOSE_BOARD_LOAD_FAILED).
   */
  | { type: 'connection'; now: number; lastLoadAttempt: number; retryIntervalMs?: number };

/** Result of a transition: the new state and an optional close for the trigger. */
export interface RoomTransition {
  state: RoomState;
  /** Close code to send to the connection that triggered the event (if any). */
  closeCode: number | null;
}

/**
 * Pure room lifecycle transition function (story 4, TC-27). Covers every
 * edge of the design's room state diagram; an event that is invalid for the
 * current state leaves the state unchanged (and closes nothing).
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomTransition {
  const none: RoomTransition = { state, closeCode: null };
  switch (state) {
    case 'loading':
      if (event.type === 'load-succeeded') return { state: 'ready', closeCode: null };
      if (event.type === 'load-failed') return { state: 'load-failed', closeCode: null };
      return none;
    case 'ready':
      if (event.type === 'append-ok') return { state: 'ready', closeCode: null };
      if (event.type === 'append-failed') return { state: 'storage-failed', closeCode: null };
      if (event.type === 'compaction-start') return { state: 'compacting', closeCode: null };
      if (event.type === 'hibernate') return { state: 'hibernated', closeCode: null };
      return none;
    case 'compacting':
      if (event.type === 'compaction-success') return { state: 'ready', closeCode: null };
      if (event.type === 'compaction-rollback') return { state: 'ready', closeCode: null };
      return none;
    case 'storage-failed':
      if (event.type === 'next-connection') return { state: 'loading', closeCode: null };
      return none;
    case 'hibernated':
      if (event.type === 'wake') return { state: 'loading', closeCode: null };
      return none;
    case 'load-failed':
      if (event.type === 'connection') {
        const interval = event.retryIntervalMs ?? LOAD_RETRY_MIN_INTERVAL_MS;
        if (event.now - event.lastLoadAttempt >= interval) {
          // The retry interval has elapsed: try loading again.
          return { state: 'loading', closeCode: null };
        }
        // Too soon: keep refusing the connection.
        return { state: 'load-failed', closeCode: CLOSE_BOARD_LOAD_FAILED };
      }
      return none;
    default:
      return none;
  }
}
