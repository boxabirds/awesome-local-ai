/**
 * Pure room state transition function for the BoardRoom lifecycle.
 *
 * States: loading, ready, compacting, storage-failed, hibernated, load-failed.
 * Events represent the transitions in the design's state diagram.
 */

export type RoomState = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'hibernated' | 'load-failed';

export type RoomEvent =
  | { type: 'load-success' }
  | { type: 'load-success-quarantined' }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-error' }
  | { type: 'storage-error' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-load-allowed' }
  | { type: 'retry-load-denied' };

/**
 * Compute the next room state given the current state and an event.
 * Invalid events for a state leave the state unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
        case 'load-success-quarantined':
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
        case 'compact-done':
        case 'compact-error':
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
        case 'retry-load-allowed':
          return 'loading';
        case 'retry-load-denied':
          return 'load-failed';
        default:
          return state;
      }
    default:
      return state;
  }
}
