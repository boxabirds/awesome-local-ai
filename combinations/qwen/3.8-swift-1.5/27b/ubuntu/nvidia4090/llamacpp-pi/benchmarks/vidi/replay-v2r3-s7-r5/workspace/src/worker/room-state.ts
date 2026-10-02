export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed'; error: string }
  | { type: 'update-stored' }
  | { type: 'storage-failed' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-load' }
  | { type: 'connection' };

/**
 * Pure state transition function for the BoardRoom lifecycle.
 * Returns the next state given the current state and an event.
 * Invalid events leave the state unchanged.
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
        case 'update-stored':
          return 'ready';
        case 'storage-failed':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }

    case 'storage-failed':
      switch (event.type) {
        case 'connection':
          return 'loading';
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    case 'load-failed':
      switch (event.type) {
        case 'connection':
          // Only transitions to loading if the retry interval has elapsed.
          // The caller checks the timestamp before emitting this event.
          return 'loading';
        case 'retry-load':
          return 'loading';
        default:
          return state;
      }

    case 'hibernated':
      switch (event.type) {
        case 'wake':
          return 'loading';
        case 'connection':
          return 'loading';
        default:
          return state;
      }

    default:
      return state;
  }
}
