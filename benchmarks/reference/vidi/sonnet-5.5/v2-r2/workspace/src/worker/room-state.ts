import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** Lifecycle of a board room (design: persist.room state diagram). */
export type RoomLifecycle =
  | 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'hibernated' | 'load-failed';

export type RoomEvent =
  | { type: 'load-ok'; quarantined?: number }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-rollback' }
  | { type: 'append-failed' }
  | { type: 'reset-complete' }   // sockets closed and doc discarded; next connection reloads
  | { type: 'idle' }             // no events, sockets may stay open
  | { type: 'wake' }             // a message or connection wakes the object
  | { type: 'connect'; sinceFailureMs: number }; // new connection to a LoadFailed room

/** Pure transition function; events that are invalid for a state leave it unchanged. */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      if (event.type === 'load-ok') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'idle') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-rollback') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'reset-complete') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'connect' && event.sinceFailureMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}
