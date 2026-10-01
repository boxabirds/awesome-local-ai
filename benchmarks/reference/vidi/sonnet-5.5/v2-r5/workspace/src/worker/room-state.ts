import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomLifecycle =
  | 'loading' | 'ready' | 'compacting' | 'load-failed' | 'storage-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'loaded'; quarantined?: number }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-error' }
  | { type: 'append-failed' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  /** A new connection arrives; `sinceLoadFailedMs` is the time since the room entered load-failed. */
  | { type: 'connection'; sinceLoadFailedMs?: number };

/** Pure transition function for the room lifecycle. Invalid events leave the state unchanged. */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-error') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'connection') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake' || event.type === 'connection') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'connection'
        && event.sinceLoadFailedMs !== undefined
        && event.sinceLoadFailedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}
