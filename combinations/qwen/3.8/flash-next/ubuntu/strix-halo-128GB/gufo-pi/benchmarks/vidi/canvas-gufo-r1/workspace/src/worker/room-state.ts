import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'compacting' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success'; quarantined?: number }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-success' }
  | { type: 'compact-rollback' }
  | { type: 'storage-error' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'connection'; timestamp: number; lastLoadFailedTime: number }
  | { type: 'retry-timer' };

/**
 * Pure state transition function for the BoardRoom lifecycle.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }

    case 'ready':
      switch (event.type) {
        case 'compact-start':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }

    case 'compacting':
      switch (event.type) {
        case 'compact-success':
          return 'ready';
        case 'compact-rollback':
          return 'ready';
        default:
          return state;
      }

    case 'storage-failed':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    case 'hibernated':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    case 'load-failed':
      switch (event.type) {
        case 'connection': {
          const elapsed = event.timestamp - event.lastLoadFailedTime;
          if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
            return 'loading';
          }
          return state;
        }
        default:
          return state;
      }

    default:
      return state;
  }
}
