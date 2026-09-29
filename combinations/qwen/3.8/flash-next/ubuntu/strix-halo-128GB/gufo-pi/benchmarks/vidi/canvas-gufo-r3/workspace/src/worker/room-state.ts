/**
 * Pure room state transitions for BoardRoom lifecycle.
 * Used by BoardRoom and unit-tested independently.
 */

export type RoomState = 'uninitialized' | 'loading' | 'ready' | 'compacting' | 'load-failed' | 'storage-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed' }
  | { type: 'update-applied' }
  | { type: 'compact-start' }
  | { type: 'compact-success' }
  | { type: 'compact-rollback' }
  | { type: 'storage-error' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-load-allowed' }
  | { type: 'retry-load-denied' };

export interface RoomStateResult {
  state: RoomState;
  /** If the state indicates the client should be closed with a code. */
  closeCode?: number;
}

/**
 * Pure state machine for the room lifecycle.
 * Returns the next state given the current state and event.
 * Invalid events for a state leave it unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomStateResult {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return { state: 'ready' };
        case 'load-failed':
          return { state: 'load-failed' };
        default:
          return { state };
      }

    case 'ready':
      switch (event.type) {
        case 'compact-start':
          return { state: 'compacting' };
        case 'storage-error':
          return { state: 'storage-failed' };
        case 'hibernate':
          return { state: 'hibernated' };
        default:
          return { state };
      }

    case 'compacting':
      switch (event.type) {
        case 'compact-success':
        case 'compact-rollback':
          return { state: 'ready' };
        default:
          return { state };
      }

    case 'load-failed':
      switch (event.type) {
        case 'retry-load-allowed':
          return { state: 'loading' };
        case 'retry-load-denied':
          return { state: 'load-failed', closeCode: 4500 };
        default:
          return { state };
      }

    case 'storage-failed':
      switch (event.type) {
        case 'wake':
          return { state: 'loading' };
        default:
          return { state };
      }

    case 'hibernated':
      switch (event.type) {
        case 'wake':
          return { state: 'loading' };
        default:
          return { state };
      }

    default:
      return { state };
  }
}
