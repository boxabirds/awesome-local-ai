/**
 * Pure room state transitions for BoardRoom persistence (story 4).
 * TC-27 tests every edge of the state diagram.
 */

export type RoomState = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'load-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success' }
  | { type: 'load-success-quarantined' }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-success' }
  | { type: 'compact-rollback' }
  | { type: 'storage-error' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-load' }
  | { type: 'retry-rejected' };

/**
 * Returns the next state for a given (state, event) pair.
 * Invalid events for a state leave it unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success': return 'ready';
        case 'load-success-quarantined': return 'ready';
        case 'load-failed': return 'load-failed';
        default: return state;
      }
    case 'ready':
      switch (event.type) {
        case 'compact-start': return 'compacting';
        case 'storage-error': return 'storage-failed';
        case 'hibernate': return 'hibernated';
        default: return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compact-success': return 'ready';
        case 'compact-rollback': return 'ready';
        default: return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'wake': return 'loading';
        default: return state;
      }
    case 'load-failed':
      switch (event.type) {
        case 'retry-load': return 'loading';
        case 'retry-rejected': return 'load-failed';
        default: return state;
      }
    case 'hibernated':
      switch (event.type) {
        case 'wake': return 'loading';
        default: return state;
      }
    default:
      return state;
  }
}
