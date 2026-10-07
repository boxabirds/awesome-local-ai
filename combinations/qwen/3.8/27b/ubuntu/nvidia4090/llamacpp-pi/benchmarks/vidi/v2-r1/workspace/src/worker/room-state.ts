// Room lifecycle state machine (story 4, persist.room contract).
//
// Pure model of the BoardRoom lifecycle diagram in the design:
//
//   [*] → Loading (construct or wake)
//   Loading → Ready            (snapshot and log applied, or quarantined rows skipped)
//   Loading → LoadFailed       (snapshot unreadable or SQL error)
//   Ready → Ready              (update applied, stored, broadcast)
//   Ready → Compacting → Ready (compaction: success or rollback)
//   Ready → StorageFailed      (append threw; sockets closed, doc discarded)
//   StorageFailed → Loading    (next connection reloads)
//   Ready → Hibernated → Loading (idle object; a message or new connection wakes it)
//   LoadFailed → Loading       (new connection after LOAD_RETRY_MIN_INTERVAL_MS)
//   LoadFailed → LoadFailed    (connection before the interval: closed 4500, no reload)
//
// Invalid events leave the state unchanged.

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  /** load() finished successfully; `quarantined` is the number of damaged log rows skipped. */
  | { type: 'loaded'; quarantined: number }
  /** load() failed; the room cannot serve the board. */
  | { type: 'load-failed'; reason: 'snapshot-unreadable' | 'sql-error' }
  /** an update was applied to the doc and durably stored (state stays ready). */
  | { type: 'update-stored' }
  /** the log reached a compaction threshold; compaction starts. */
  | { type: 'compact' }
  /** compaction finished; `rolledBack` when a storage failure rolled it back (log intact). */
  | { type: 'compact-done'; rolledBack: boolean }
  /** storing an update threw: sockets are closed with 1011 and the doc discarded. */
  | { type: 'storage-error' }
  /** the object became idle; it may hibernate with open sockets. */
  | { type: 'hibernate' }
  /** a message or new connection woke a hibernated object (reconstruct + reload). */
  | { type: 'wake' }
  /** a new connection arrived; for a load-failed room only then may it reload. */
  | { type: 'connection'; retryIntervalElapsed: boolean };

/** The valid edges of the lifecycle diagram; any other (state, event) pair is
 * invalid and leaves the state unchanged. */
const TRANSITIONS: Record<string, RoomState> = {
  'loading|loaded': 'ready',
  'loading|load-failed': 'load-failed',
  'ready|update-stored': 'ready',
  'ready|compact': 'compacting',
  'compacting|compact-done': 'ready',
  'ready|storage-error': 'storage-failed',
  'ready|hibernate': 'hibernated',
  'hibernated|wake': 'loading',
  'storage-failed|connection-elapsed': 'loading',
  'storage-failed|connection-not-elapsed': 'loading',
  // A load-failed room only reloads once the retry interval has elapsed;
  // an earlier connection is closed with 4500 and the state is unchanged.
  'load-failed|connection-elapsed': 'loading',
  'load-failed|connection-not-elapsed': 'load-failed',
};

export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  const key =
    event.type === 'connection'
      ? `${state}|connection-${event.retryIntervalElapsed ? 'elapsed' : 'not-elapsed'}`
      : `${state}|${event.type}`;
  return TRANSITIONS[key] ?? state;
}
