/**
 * Room lifecycle state machine (story 4, `persist.room`).
 *
 * A pure description of the lifecycle diagram in the design: the BoardRoom
 * keeps its current state here so that "who may talk to the document right
 * now" has one answer, and so the transitions can be tested without a
 * Durable Object, a socket or a database (TC-27).
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config'

export type RoomState = 'loading' | 'ready' | 'compacting' | 'hibernated' | 'storage-failed' | 'load-failed'

export type RoomEvent =
  /** The load finished: `ok` false means snapshot damage or a SQL error. */
  | { type: 'load-result'; ok: boolean; quarantined: number }
  /** An update was applied; `overThreshold` means the log now deserves compaction. */
  | { type: 'update'; overThreshold: boolean }
  /** Compaction finished (committed or rolled back — both return to Ready). */
  | { type: 'compact'; ok: boolean }
  /** A storage write threw: the room stops serving until the next connection. */
  | { type: 'storage-error' }
  /** Nothing is happening; the object may be evicted while sockets stay open. */
  | { type: 'idle' }
  /** A message or a new connection woke a hibernated / broken object. */
  | { type: 'wake' }
  /** A socket is being accepted; `elapsedMs` is time since the last load failure. */
  | { type: 'client-open'; elapsedMs: number }

export const ROOM_STATES: readonly RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'hibernated',
  'storage-failed',
  'load-failed',
]

/**
 * The one transition table. Anything not listed leaves the state unchanged:
 * an event that cannot happen in a state must never move it (TC-27).
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      // While the load is in flight nothing else decides the outcome.
      if (event.type === 'load-result') return event.ok ? 'ready' : 'load-failed'
      return state

    case 'ready':
      if (event.type === 'update') return event.overThreshold ? 'compacting' : 'ready'
      if (event.type === 'storage-error') return 'storage-failed'
      if (event.type === 'idle') return 'hibernated'
      return state

    case 'compacting':
      // A committed compaction and a rolled-back one both land back in Ready;
      // a failing statement inside the transaction is a storage failure.
      if (event.type === 'compact') return 'ready'
      if (event.type === 'storage-error') return 'storage-failed'
      return state

    case 'storage-failed':
      // The document was discarded: the next connection reloads it.
      if (event.type === 'wake' || event.type === 'client-open') return 'loading'
      return state

    case 'hibernated':
      if (event.type === 'wake' || event.type === 'client-open') return 'loading'
      return state

    case 'load-failed':
      // Retry, but at most once per LOAD_RETRY_MIN_INTERVAL_MS; before that the
      // socket is closed with CLOSE_BOARD_LOAD_FAILED straight away.
      if (event.type === 'client-open' && event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading'
      return state

    default:
      return state
  }
}

/** True when document traffic must not be applied (the board is not readable). */
export function blocksUpdates(state: RoomState): boolean {
  return state === 'loading' || state === 'load-failed' || state === 'storage-failed'
}
