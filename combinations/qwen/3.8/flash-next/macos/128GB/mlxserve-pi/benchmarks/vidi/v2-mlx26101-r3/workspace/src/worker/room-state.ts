import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * The room's own lifecycle, as a pure function of state and event.
 *
 * Story 4 gives `BoardRoom` six states: it loads when it is constructed or woken, serves
 * from memory once the saved board is in, compacts the log when that log gets long, goes
 * dormant when nobody is connected, and - the two that users can tell apart from outside -
 * refuses to serve anything until its saved board can be read again after a load failure,
 * and stops serving altogether when a write to storage fails.
 *
 * Only the *serving* states are stored on the object (the design's `RoomState`); the
 * transient ones are in the diagram and in this function, because what is allowed to happen
 * depends on which of them the room is in. Keeping the transitions here means the room has
 * one place that says what may follow what, and a test can ask it every question in the
 * diagram without waking a Durable Object to answer it.
 *
 * An event that a state cannot answer leaves the state alone: the room asks what should
 * happen next, and gets the current state back for anything it did not expect.
 */

/** What the room does with a connection: the states a client can observe. */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/** Every state of the room's lifecycle diagram, transient ones included. */
export type LifecycleState = 'loading' | 'compacting' | 'hibernated' | RoomState;

/**
 * One thing that can happen to a room.
 *
 * `wake` is the runtime constructing or waking the object, which is when the saved board is
 * read; `connection` is a client arriving, which is the only thing that can end a load
 * failure - and only once {@link LOAD_RETRY_MIN_INTERVAL_MS} has passed since the last one.
 */
export type RoomEvent =
  | { type: 'wake' }
  | { type: 'load-ok' }
  | { type: 'load-error' }
  | { type: 'update' }
  | { type: 'compact' }
  | { type: 'compact-ok' }
  | { type: 'compact-error' }
  | { type: 'storage-error' }
  | { type: 'hibernate' }
  | { type: 'connection'; msSinceLoadFailure: number };

/**
 * The state that follows, or `state` itself for an event this state does not handle.
 */
export function nextRoomState(state: LifecycleState, event: RoomEvent): LifecycleState {
  switch (state) {
    case 'loading':
      // Reading the board is the only thing happening here: it works, or it does not.
      if (event.type === 'load-ok') {
        return 'ready';
      }
      return event.type === 'load-error' ? 'load-failed' : state;
    case 'ready':
      switch (event.type) {
        case 'update':
          return 'ready';
        case 'compact':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        case 'connection':
          return 'ready';
        default:
          return state;
      }
    case 'compacting':
      // Both ways out of a fold-up leave the room serving: a failed one rolled back and left
      // the log alone, which is what ready looked like beforehand.
      return event.type === 'compact-ok' || event.type === 'compact-error' ? 'ready' : state;
    case 'hibernated':
      // A message or a person, and reading the board is the first thing either of them does.
      return event.type === 'wake' || event.type === 'connection' ? 'loading' : state;
    case 'storage-failed':
      // Nothing can be served from a document whose writes went nowhere; a fresh connection
      // is what makes the room read the board back from storage.
      return event.type === 'wake' || event.type === 'connection' ? 'loading' : state;
    case 'load-failed':
      if (event.type !== 'connection') {
        return state;
      }
      return event.msSinceLoadFailure >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
  }
}
