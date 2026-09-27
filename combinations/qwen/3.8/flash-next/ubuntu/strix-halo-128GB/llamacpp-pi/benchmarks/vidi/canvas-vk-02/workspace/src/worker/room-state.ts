/**
 * The board room's lifecycle as a pure transition function
 * (design "Persistent, hibernating board room", state diagram).
 *
 * Everything about *when* the room may serve, must refuse, or must reload is
 * decided here rather than inside the Durable Object, so the whole lifecycle —
 * including the edges that need an eviction or a storage failure to reach —
 * is covered by unit tests (TC-27) instead of integration plumbing.
 *
 * `BoardRoom` keeps one of these values and moves it with `nextRoomState`;
 * `observableState` reduces the lifecycle to the three states the room's
 * contract names, which is what a connection is answered with.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** Every state of the design's room lifecycle diagram. */
export type RoomLifecycle =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** The three states a connection can observe (design contract). */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/**
 * Everything that can happen to a room.
 *
 * - `construct` — the object was created or woken and starts loading.
 * - `load-ok` / `load-quarantined` / `load-failed` — the outcome of a load.
 * - `update` — a change was applied, stored and broadcast.
 * - `compact-start` / `compact-done` / `compact-failed` — compaction, which
 *   rolls back to an intact snapshot and log on failure.
 * - `storage-error` — an insert threw: the document is discarded.
 * - `idle` — the last person left; the object may be evicted at any time.
 * - `wake` — a message or a new connection arrives after `idle`; a reconstructed
 *   object reads storage again.
 * - `reload` — leave `storage-failed` and read storage again.
 * - `retry-load` — a connection arrives at a room that failed to load; only
 *   `LOAD_RETRY_MIN_INTERVAL_MS` after the failure is a new attempt made.
 */
export type RoomEvent =
  | { type: 'construct' }
  | { type: 'load-ok' }
  | { type: 'load-quarantined' }
  | { type: 'load-failed' }
  | { type: 'update' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-failed' }
  | { type: 'storage-error' }
  | { type: 'idle' }
  | { type: 'wake' }
  | { type: 'reload' }
  | { type: 'retry-load'; elapsedMs: number };

/** Every event type, for the transition tests and for exhaustiveness checks. */
export const ROOM_EVENT_TYPES = [
  'construct',
  'load-ok',
  'load-quarantined',
  'load-failed',
  'update',
  'compact-start',
  'compact-done',
  'compact-failed',
  'storage-error',
  'idle',
  'wake',
  'reload',
  'retry-load',
] as const satisfies readonly RoomEvent['type'][];

export const ROOM_LIFECYCLE_STATES = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
] as const satisfies readonly RoomLifecycle[];

/**
 * The one rule with a number in it: a room that could not load is not asked
 * again until `LOAD_RETRY_MIN_INTERVAL_MS` have passed.
 */
export function shouldRetryLoad(state: RoomLifecycle, now: number, failedAt: number): boolean {
  return state === 'load-failed' && now - failedAt >= LOAD_RETRY_MIN_INTERVAL_MS;
}

/**
 * The lifecycle transition function. Not listed is not allowed: an event that
 * means nothing in the current state leaves the state exactly as it was, so a
 * stray message cannot, for example, resurrect a document that was discarded
 * after a storage failure.
 */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-ok':
        case 'load-quarantined':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update':
          return 'ready';
        case 'compact-start':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'idle':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      // Success and rollback both leave the room serving: a failed compaction
      // keeps the previous snapshot and the whole log.
      switch (event.type) {
        case 'compact-done':
        case 'compact-failed':
          return 'ready';
        default:
          return state;
      }
    case 'storage-failed':
      return event.type === 'reload' ? 'loading' : state;
    case 'hibernated':
      return event.type === 'wake' ? 'loading' : state;
    case 'load-failed':
      if (event.type === 'retry-load') {
        return event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
      }
      return state;
  }
}

/**
 * Reduce the lifecycle to what a connection can observe. `loading`,
 * `compacting` and `hibernated` are transient inside one turn of the event
 * loop — a room never answers a socket in them — so they answer as `ready`.
 */
export function observableState(state: RoomLifecycle): RoomState {
  if (state === 'load-failed') return 'load-failed';
  if (state === 'storage-failed') return 'storage-failed';
  return 'ready';
}
