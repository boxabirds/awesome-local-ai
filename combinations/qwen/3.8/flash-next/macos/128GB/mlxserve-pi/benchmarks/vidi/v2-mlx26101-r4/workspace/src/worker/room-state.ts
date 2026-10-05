/**
 * The room's own lifecycle, as a pure function of what just happened.
 *
 * A board room spends its life in one of six places, and nearly every bug in a
 * persistent room is a question about *which* one it is allowed to move to next:
 * may a board that failed to load answer a message? Does a failed compaction go
 * back to serving people, or does it have to be re-read first? Written as a table,
 * those answers are one line each and can be tested without a socket, a database or
 * a clock.
 *
 * `nextRoomState` is the whole policy; `BoardRoom` is the thing that decides which
 * event happened and then does what the resulting state says.
 */

/**
 * What a room is willing to tell a client about itself: it has the board, it could
 * not read the board, or it could not write the board. `BoardRoom` re-exports this
 * under the same name, because it is the room's own contract.
 */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/**
 * Where the room is in its own life.
 *
 * `loading` and `compacting` are transient — no connection is ever answered from
 * them, because the work that ends them is synchronous. `hibernated` is the room
 * holding no document while its sockets sleep; `hibernated` and `loading` together
 * are what "an idle board costs nothing" means.
 */
export type RoomLifecycle =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'hibernated'
  | 'storage-failed'
  | 'load-failed';

/**
 * Where a room born this second is: reading itself back.
 *
 * There is no other answer. A room that was constructed has no document yet, and the
 * one thing this story promises is that it does not decide what a board looks like
 * before it has read the board.
 */
export const INITIAL_ROOM_LIFECYCLE: RoomLifecycle = 'loading';

/** Something that can happen to a room. */
export type RoomEvent =
  /** The object was constructed or woken, and is going to read storage. */
  | 'wake'
  /** The snapshot and the log were applied. */
  | 'loaded'
  /** The log was applied, with damaged rows quarantined and the rest loaded. */
  | 'loaded-quarantined'
  /** The snapshot could not be read, or the read itself failed. */
  | 'load-failed'
  /** The log passed a compaction threshold. */
  | 'compact'
  /** The snapshot was replaced and the log truncated. */
  | 'compacted'
  /** Compaction threw; its transaction rolled back and the log is intact. */
  | 'compact-rolled-back'
  /** An insert threw: this board cannot be written. */
  | 'storage-failed'
  /** The last socket left; there is nothing left to hold in memory. */
  | 'idle'
  /** A connection arrived, and the wait since the last failure is long enough. */
  | 'retry';

/**
 * The lifecycle a client is ever shown.
 *
 * The transient states are not a client's business: a connection is only answered
 * once the room has settled, because the work that settles it — a read, a compaction
 * — is synchronous. So a room that is `compacting` has a board, and a room that is
 * `hibernated` has a board in storage and a document it is about to read back.
 */
export function roomStateOf(lifecycle: RoomLifecycle): RoomState {
  if (lifecycle === 'load-failed') return 'load-failed';
  if (lifecycle === 'storage-failed') return 'storage-failed';
  return 'ready';
}

/**
 * Every move that is allowed; everything else is silence.
 *
 * A state that is asked to do something it does not do returns itself rather than
 * throwing: a room that is told to compact while it is still reading its board has not
 * broken, the room code has, and the least destructive outcome is that nothing changes.
 */
const TRANSITIONS: Record<RoomLifecycle, Partial<Record<RoomEvent, RoomLifecycle>>> = {
  // Nothing is served while a board is being read. A connection that arrives here is
  // answered by whatever the read turns out to be, and the read is synchronous, so no
  // connection ever has to wait for it.
  loading: {
    loaded: 'ready',
    'loaded-quarantined': 'ready',
    'load-failed': 'load-failed',
  },
  ready: {
    compact: 'compacting',
    // A write that failed is not retried behind anybody's back: the clients still open
    // are holding changes that never landed, and they are the only ones who can decide
    // what happens to them.
    'storage-failed': 'storage-failed',
    // The last socket has gone. The board is in storage, and holding a copy of it in
    // memory until the runtime decides to evict this object is a cost with no benefit.
    idle: 'hibernated',
  },
  // A compaction that rolled back is not a broken board: the log it could not fold is
  // still the log, the old snapshot is still the snapshot, and this is the same board,
  // still serving, with the same rows still to be folded away.
  compacting: {
    compacted: 'ready',
    'compact-rolled-back': 'ready',
  },
  // Only a new connection reloads a board that could not be written — not the passage of
  // time, and not another message from a client that is still holding the change. There is no
  // wait on this one, unlike a board that could not be *read*: the storage is readable, and the
  // people who are holding the change that never landed are the only ones who can put it back,
  // so the next one of them to arrive is met by a room that has read itself again.
  'storage-failed': { wake: 'loading', retry: 'loading' },
  // A board that nobody is looking at is not held in memory; the first connection reads
  // it back.
  hibernated: { wake: 'loading' },
  // The only way out of a board that could not be read is another attempt, and the room
  // waits LOAD_RETRY_MIN_INTERVAL_MS before it makes one.
  'load-failed': { retry: 'loading' },
};

/**
 * The state after `event`, or the same state when this event is not this state's business.
 *
 * TC-27 is the negative half of that: the events a state must ignore.
 */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  return TRANSITIONS[state][event] ?? state;
}
