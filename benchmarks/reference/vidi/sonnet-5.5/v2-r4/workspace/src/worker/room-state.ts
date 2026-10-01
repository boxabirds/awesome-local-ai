import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomLifecycle = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'hibernated' | 'load-failed';

export type RoomEvent =
  | { type: 'loaded' }
  | { type: 'loaded-quarantined' }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-rollback' }
  | { type: 'append-failed' }
  | { type: 'reset' } // sockets closed and doc discarded after a storage failure
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'connect'; msSinceLoadFailure: number };

/** Room lifecycle transitions; an event that is not valid for the state leaves it unchanged. */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded' || event.type === 'loaded-quarantined') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-rollback') return 'ready';
      return state;
    case 'storage-failed':
      return event.type === 'reset' ? 'loading' : state;
    case 'hibernated':
      return event.type === 'wake' ? 'loading' : state;
    case 'load-failed':
      if (event.type === 'connect' && event.msSinceLoadFailure >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}
