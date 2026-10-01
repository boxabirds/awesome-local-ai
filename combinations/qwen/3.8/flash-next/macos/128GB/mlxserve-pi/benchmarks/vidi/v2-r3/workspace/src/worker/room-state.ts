// The BoardRoom lifecycle as a pure function, so every edge of the design's
// room state diagram is testable without a runtime (TC-27). The Durable Object
// holds one of these states; `nextRoomState` says what a given event does to it.
//
//   loading  — the object was constructed or woken and is reading storage.
//   ready    — the document is loaded; updates are applied, stored, broadcast.
//   compacting — the log crossed a threshold and is folded into a snapshot.
//   storage-failed — a write failed; every socket is being closed, the next
//                    connection reloads from storage (persist.save_failure).
//   hibernated — no events pending; the runtime may evict memory, but the
//                sockets stay accepted (idle boards cost nothing).
//   load-failed — storage could not be read; the room refuses to serve an empty
//                 board and retries at most once per LOAD_RETRY_MIN_INTERVAL_MS
//                 (persist.load_failure).
import { CLOSE_BOARD_LOAD_FAILED } from '../shared/protocol';

/** Every state the room's lifecycle passes through. */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** The three states a live room reports to its clients and its own handlers. */
export type LiveRoomState = 'ready' | 'load-failed' | 'storage-failed';

/** An event in the room's life. `retryDue` says whether a LoadFailed room is
 *  allowed to try loading again (LOAD_RETRY_MIN_INTERVAL_MS has passed); when it
 *  is not, a connecting client is refused without a load attempt (close 4500). */
export type RoomEvent =
  | { type: 'load-ok' }
  | { type: 'load-failed' }
  | { type: 'update' }
  | { type: 'compact' }
  | { type: 'compact-ok' }
  | { type: 'compact-rolled-back' }
  | { type: 'storage-error' }
  | { type: 'reconnect' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'connection'; retryDue: boolean };

/** The close code a `(state, event)` pair hands a client, if any. It is a side
 *  effect of the transition, not the next state: a refused LoadFailed
 *  connection changes nothing about the room but tells the client why. */
export function closeCodeFor(state: RoomState, event: RoomEvent): number | null {
  if (state === 'load-failed' && event.type === 'connection' && !event.retryDue) {
    return CLOSE_BOARD_LOAD_FAILED;
  }
  if (state === 'storage-failed' && event.type === 'connection') {
    return null; // a connection to a storage-failed room reloads rather than closes
  }
  return null;
}

/** The next state for `(state, event)`, or the same state for an event that
 *  does not apply to it (an invalid event leaves the room as it was). */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case 'load-ok':
      return state === 'loading' ? 'ready' : state;
    case 'load-failed':
      return state === 'loading' ? 'load-failed' : state;
    case 'update':
      return state === 'ready' ? 'ready' : state;
    case 'compact':
      return state === 'ready' ? 'compacting' : state;
    case 'compact-ok':
    case 'compact-rolled-back':
      return state === 'compacting' ? 'ready' : state;
    case 'storage-error':
      return state === 'ready' || state === 'compacting' ? 'storage-failed' : state;
    case 'reconnect':
      // The next connection to a room that lost its document reloads it.
      return state === 'storage-failed' ? 'loading' : state;
    case 'hibernate':
      return state === 'ready' ? 'hibernated' : state;
    case 'wake':
      return state === 'hibernated' ? 'loading' : state;
    case 'connection':
      if (state === 'ready') return 'ready';
      if (state === 'load-failed') return event.retryDue ? 'loading' : 'load-failed';
      return state;
  }
}
