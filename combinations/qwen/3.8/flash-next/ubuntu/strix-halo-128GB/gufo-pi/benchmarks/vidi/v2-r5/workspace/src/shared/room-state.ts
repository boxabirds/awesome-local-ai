/**
 * Pure room state transition function.
 * Derived from the design's room lifecycle state diagram.
 */

export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'hibernated' | 'compacting';

export type RoomEvent =
  | 'load-success'
  | 'load-quarantined'
  | 'load-failed'
  | 'append-start'
  | 'compact-start'
  | 'compact-success'
  | 'compact-rollback'
  | 'storage-error'
  | 'hibernate'
  | 'wake'
  | 'retry-load'
  | 'retry-reject';

/**
 * Returns the next state given the current state and event.
 * Invalid events for a state leave it unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event) {
        case 'load-success': return 'ready';
        case 'load-quarantined': return 'ready';
        case 'load-failed': return 'load-failed';
        default: return state;
      }
    case 'ready':
      switch (event) {
        case 'compact-start': return 'compacting';
        case 'storage-error': return 'storage-failed';
        case 'hibernate': return 'hibernated';
        default: return state;
      }
    case 'compacting':
      switch (event) {
        case 'compact-success': return 'ready';
        case 'compact-rollback': return 'ready';
        default: return state;
      }
    case 'storage-failed':
      switch (event) {
        case 'wake': return 'loading';
        default: return state;
      }
    case 'hibernated':
      switch (event) {
        case 'wake': return 'loading';
        default: return state;
      }
    case 'load-failed':
      switch (event) {
        case 'retry-load': return 'loading';
        case 'retry-reject': return 'load-failed';
        default: return state;
      }
    default:
      return state;
  }
}
