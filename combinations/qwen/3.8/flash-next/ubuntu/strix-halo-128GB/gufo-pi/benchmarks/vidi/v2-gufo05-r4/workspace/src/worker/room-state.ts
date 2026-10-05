/**
 * The board room's lifecycle as a pure transition function.
 *
 * `BoardRoom` has to be right about one thing above everything else: it never
 * serves a board it has not read. "Empty" and "unreadable" look identical from
 * the outside unless the state machine says which one this is, and a room that
 * gets that wrong deletes somebody's workshop. So the edges live here, where
 * they can be enumerated and tested, and the room only ever asks
 * `nextRoomState(state, event)` what it is allowed to become.
 *
 * ```text
 *  loading ──loaded──▶ ready ──compact──▶ compacting ──compacted──▶ ready
 *      ▲                 │  └──compact-rolled-back──▶ ready         │
 *      │                 ├──storage-error──▶ storage-failed ──reconnect──▶ loading
 *      │                 └──hibernate──▶ hibernated ──wake──▶ loading
 *  load-failed ──reopen (after LOAD_RETRY_MIN_INTERVAL_MS)──▶ loading
 * ```
 *
 * Anything not drawn is not allowed: an event that does not apply to the current
 * state leaves the state exactly as it was, which is what makes a stray message
 * after a reset harmless rather than corrupting.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * The states a running room can be observed in. `loading`, `compacting` and
 * `hibernated` are the same room caught mid-operation and are part of the
 * lifecycle type below.
 */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/** Every node of the lifecycle diagram. */
export type RoomLifecycleState = 'loading' | RoomState | 'compacting' | 'hibernated';

/** Something that can happen to a room. */
export type RoomEvent =
  /** The snapshot and log were applied: the board is safe to serve. */
  | { type: 'loaded' }
  /** The snapshot could not be read, or storage could not be read at all. */
  | { type: 'load-failed' }
  /** A client's update was applied to the document. */
  | { type: 'update' }
  /** The log passed its threshold and is being folded into a snapshot. */
  | { type: 'compact' }
  /** The new snapshot and the truncated log committed together. */
  | { type: 'compacted' }
  /** A statement failed; the transaction rolled back with the old state intact. */
  | { type: 'compact-rolled-back' }
  /** A write failed: the change was not stored, so it was never broadcast. */
  | { type: 'storage-error' }
  /** A connection arrives at a room that has thrown away its document. */
  | { type: 'reconnect' }
  /** Nothing to do; any sockets are hibernated and the object may be evicted. */
  | { type: 'hibernate' }
  /** A message or a new connection woke the object: the document must be re-read. */
  | { type: 'wake' }
  /**
   * A connection arrives at a board that failed to load. `sinceFailureMs` is how
   * long ago that happened; only after `LOAD_RETRY_MIN_INTERVAL_MS` is a retry
   * worth making, and before it the room stays `load-failed` (and the socket is
   * closed with `CLOSE_BOARD_LOAD_FAILED`).
   */
  | { type: 'reopen'; sinceFailureMs: number };

/** Every event type, so a test can ask about all of them at once. */
export const ROOM_EVENT_TYPES = [
  'loaded',
  'load-failed',
  'update',
  'compact',
  'compacted',
  'compact-rolled-back',
  'storage-error',
  'reconnect',
  'hibernate',
  'wake',
  'reopen'
] as const satisfies readonly RoomEvent['type'][];

/** Is `next` an edge this room is allowed to take? */
export function canEnter(from: RoomLifecycleState, to: RoomLifecycleState): boolean {
  return reachableFrom(from).includes(to);
}

/** The states one event away from `from`, `from` itself included. */
export function reachableFrom(from: RoomLifecycleState): RoomLifecycleState[] {
  switch (from) {
    case 'loading':
      return ['loading', 'ready', 'load-failed'];
    case 'ready':
      return ['ready', 'compacting', 'storage-failed', 'hibernated'];
    case 'compacting':
      return ['compacting', 'ready'];
    case 'storage-failed':
      return ['storage-failed', 'loading'];
    case 'hibernated':
      return ['hibernated', 'loading'];
    case 'load-failed':
      return ['load-failed', 'loading'];
  }
}

/**
 * The state `state` becomes when `event` happens. An event that does not belong
 * to the current state changes nothing — see the diagram in the header.
 */
export function nextRoomState(state: RoomLifecycleState, event: RoomEvent): RoomLifecycleState {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;

    case 'ready':
      if (event.type === 'compact') return 'compacting';
      if (event.type === 'storage-error') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      // `update` keeps it ready; everything else is noise from an operation that
      // is not running.
      return state;

    case 'compacting':
      if (event.type === 'compacted') return 'ready';
      if (event.type === 'compact-rolled-back') return 'ready';
      return state;

    case 'storage-failed':
      // The document is gone; only a new connection brings it back, by loading.
      if (event.type === 'reconnect') return 'loading';
      return state;

    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return state;

    case 'load-failed':
      if (event.type === 'reopen') {
        return event.sinceFailureMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
      }
      return state;
  }
}

/**
 * Should a socket that arrives at a `load-failed` room be answered with a load
 * attempt, or turned away with `CLOSE_BOARD_LOAD_FAILED`?
 */
export function shouldRetryLoad(sinceFailureMs: number): boolean {
  return nextRoomState('load-failed', { type: 'reopen', sinceFailureMs }) === 'loading';
}
