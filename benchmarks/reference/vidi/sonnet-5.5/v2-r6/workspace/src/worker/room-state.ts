import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/** Lifecycle of a board room (design: room lifecycle state diagram). */
export type RoomPhase = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'hibernated' | 'load-failed';

export type RoomEvent =
  | { type: 'loaded' } // snapshot and log applied (damaged log rows may have been quarantined)
  | { type: 'load-error' } // snapshot unreadable or SQL error
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-failed' } // rolled back, log intact
  | { type: 'append-failed' }
  | { type: 'reset' } // sockets closed and doc discarded
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'connect'; sinceLoadFailedMs: number };

/** Pure transition function; events that are invalid in a state leave it unchanged. */
export function nextRoomState(state: RoomPhase, event: RoomEvent): RoomPhase {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-error') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-failed') return 'ready';
      return state;
    case 'storage-failed':
      return event.type === 'reset' ? 'loading' : state;
    case 'hibernated':
      return event.type === 'wake' ? 'loading' : state;
    case 'load-failed':
      if (event.type === 'connect' && event.sinceLoadFailedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}
