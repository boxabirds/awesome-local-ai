import type * as Y from 'yjs';

import type { LoadResult } from './board-store';

/**
 * The room's state, and the rules that read it.
 *
 * A board room is not "a `Y.Doc` with sockets attached to it" any more. It is a
 * cache that may be empty: the object can be torn down while its sockets are held
 * open by the runtime, and the next message has to be answered from whatever the
 * object's SQLite says. That makes three things worth naming separately rather
 * than hiding in a chain of `if`s inside a message handler:
 *
 *  - **cold** — this instance has not read the board yet. The next arrival reads
 *    it, and nothing is answered before the read finishes.
 *  - **loaded** — the room holds a board. A new member is answered from it,
 *    unless the room has been asleep, in which case the copy is stale and the
 *    read happens anyway.
 *  - **failed** — the last read was damaged, late or thrown. Joins are refused
 *    until the state is cleared. Not retried per message: a broken read does not
 *    get better by being hit forty times a second, and the retry budget belongs
 *    to the client.
 *
 * `RoomState` is the data, `roomStateAfter` is the only thing that changes it,
 * `loadActionFor` is the only thing that decides whether to read, and
 * `shouldCheckpoint` is the only thing that decides whether to write. The harness
 * in `tests/unit/room-harness.ts` runs all three against a fake clock and a fake
 * store, which is what lets TC-17, TC-20, TC-24 and TC-28 have unit tests.
 */

/** What the room knows about the board between messages. */
export type RoomStateName = 'cold' | 'loaded' | 'failed';

/** Everything the room remembers, and everything a restart has to forget. */
export interface RoomState {
  name: RoomStateName;
  /** The board, or `null` while cold or failed. */
  doc: Y.Doc | null;
  /** Whether the room has been asleep since the board was read. */
  slept: boolean;
  /** Updates buffered since the last checkpoint. */
  pendingUpdates: number;
  /** Bytes buffered since the last checkpoint. */
  pendingBytes: number;
  /** When the oldest buffered update arrived, on the host's clock. */
  pendingSince: number;
  /** Joins refused because the board could not be loaded. */
  refused: number;
}

/** A brand-new room state: cold, empty, nothing buffered. */
export function freshRoomState(): RoomState {
  return {
    name: 'cold',
    doc: null,
    slept: false,
    pendingUpdates: 0,
    pendingBytes: 0,
    pendingSince: 0,
    refused: 0,
  };
}

/** What happens to the room's state. The return value is what the room *does*. */
export type RoomEvent =
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'loaded'; doc: Y.Doc }
  | { type: 'failed' }
  | { type: 'update'; bytes: number; at: number }
  | { type: 'flushed' };

/**
 * The transition table, in one place.
 *
 * `wake` never means "the board is in here": it only clears `slept`, and the room
 * still reads, because a room that hibernated has no board. A `loaded` event with
 * a document is the only way into `loaded`, and `failed` only leaves through a
 * reset — never by trying the same read again.
 */
export function roomStateAfter(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case 'sleep':
      return { ...state, slept: true };
    case 'wake':
      return { ...state, slept: false };
    case 'loaded':
      return { ...state, name: 'loaded', doc: event.doc, slept: false };
    case 'failed':
      // The board goes with the failure: a room that could not read its board
      // does not get to answer from the copy it read last time.
      return { ...state, name: 'failed', doc: null, slept: false, pendingBytes: 0, pendingUpdates: 0 };
    case 'update':
      return {
        ...state,
        pendingUpdates: state.pendingUpdates + 1,
        pendingBytes: state.pendingBytes + event.bytes,
        pendingSince: state.pendingSince === 0 ? event.at : state.pendingSince,
      };
    case 'flushed':
      return { ...state, pendingUpdates: 0, pendingBytes: 0, pendingSince: 0 };
    default:
      return state;
  }
}

/** Whether this room has to read its board before it says anything. */
export type LoadAction = 'load' | 'nothing' | 'refuse';

/**
 * The one decision that is not about a frame.
 *
 * `cold` reads. `loaded` and awake does not. `failed` refuses. A room that has
 * been asleep reads even when it still holds a document, because "I remember a
 * board" is not the same as "this is the board" — which is the difference between
 * a stale board being served and a stale board being re-read.
 */
export function loadActionFor(state: RoomState): LoadAction {
  if (state.name === 'failed') return 'refuse';
  if (state.name === 'cold') return 'load';
  if (state.slept) return 'load';
  return 'nothing';
}

/** Whether the buffered updates should be written down now. */
export function shouldCheckpoint(
  state: RoomState,
  now: number,
  limits: { updates: number; intervalMs: number },
  force = false,
): boolean {
  if (state.pendingUpdates === 0) return false;
  if (force) return true;
  if (state.pendingUpdates >= limits.updates) return true;
  return now - state.pendingSince >= limits.intervalMs;
}

/**
 * The part of storage the room's rules need.
 *
 * Two implementations exist: the Durable Object's SQLite (`RoomStore`, which
 * answers `null`, bytes, or `STATE_UNREADABLE`), and an in-memory stand-in used
 * by the unit tests and the harness. Neither is asynchronous, which is what makes
 * "the load happens before the answer" a property of the code rather than of the
 * scheduler — and what lets a test make storage *throw*, which is one of the
 * three failures rule 5 has to answer the same way as a short read.
 */
export interface StateStore {
  /** Bytes, `null` for "nothing stored yet", `STATE_UNREADABLE` for damage. */
  load(boardId: string): LoadResult;
  /** Throws to say the write did not happen. */
  save(boardId: string, bytes: Uint8Array): void;
}

/** How a host answers the room's questions about time, storage and sockets. */
export interface RoomHost {
  /** Which board this room is the cache of. */
  readonly boardId: string;
  /** The board's stored state. */
  readonly store: StateStore;
  /** Sockets the runtime is holding for this room, including this one. */
  members(): readonly WebSocket[];
  /** A clock in milliseconds. The harness's is a number the test moves. */
  now(): number;
  /** How long a board read may take before it counts as a failure. */
  loadTimeoutMs(): number;
  /** Log one line. The room's only output channel. */
  log(line: string): void;
}
