import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * Room lifecycle states (story 4 state diagram).
 *
 * - loading: object constructed or woken; loading from storage
 * - ready: serving clients
 * - load-failed: stored board unreadable; retrying on new connections
 * - storage-failed: an append threw; doc discarded, sockets closed
 * - compacting: log being compacted into a snapshot
 * - hibernated: no events; the runtime may freeze the object
 */
export type RoomState =
  | 'loading'
  | 'ready'
  | 'load-failed'
  | 'storage-failed'
  | 'compacting'
  | 'hibernated';

export type RoomEvent =
  | { type: 'load-ok'; quarantined: number }
  | { type: 'load-failed'; reason: string }
  | { type: 'update' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-rolled-back' }
  | { type: 'storage-failed' }
  | { type: 'hibernate' }
  | { type: 'wake'; elapsedMs: number };

/**
 * Pure room state transition function. Invalid events leave the state
 * unchanged. A `wake` of a load-failed room only reloads once
 * LOAD_RETRY_MIN_INTERVAL_MS has elapsed since the last attempt.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      if (event.type === 'load-ok') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;

    case 'ready':
      if (event.type === 'update') return 'ready';
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'storage-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;

    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-rolled-back') return 'ready';
      return state;

    case 'storage-failed':
      // Sockets are closed and the doc discarded; the next connection reloads.
      if (event.type === 'wake') return 'loading';
      return state;

    case 'hibernated':
      // A message or new connection wakes (and re-constructs) the object.
      if (event.type === 'wake') return 'loading';
      return state;

    case 'load-failed':
      // Retry the load at most once per LOAD_RETRY_MIN_INTERVAL_MS.
      if (event.type === 'wake' && event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}

export { LOAD_RETRY_MIN_INTERVAL_MS };
