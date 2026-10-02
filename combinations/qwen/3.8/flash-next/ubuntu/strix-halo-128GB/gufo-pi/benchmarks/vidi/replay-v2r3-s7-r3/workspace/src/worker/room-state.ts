/**
 * Pure room state transitions for the BoardRoom lifecycle.
 * Story 4: persistence.
 */

export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success' }
  | { type: 'load-success-quarantined' }
  | { type: 'load-failed' }
  | { type: 'compact-start' }
  | { type: 'compact-success' }
  | { type: 'compact-rollback' }
  | { type: 'storage-error' }
  | { type: 'storage-recovered' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-load-elapsed' }
  | { type: 'retry-load-too-soon' };

/**
 * Returns the next room state for a given current state and event.
 * Invalid events for a state leave the state unchanged.
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
        case 'compact-start': return 'ready'; // stays ready during compaction
        case 'compact-success': return 'ready';
        case 'compact-rollback': return 'ready';
        case 'storage-error': return 'storage-failed';
        case 'hibernate': return 'hibernated';
        default: return state;
      }
    case 'load-failed':
      switch (event.type) {
        case 'retry-load-elapsed': return 'loading';
        case 'retry-load-too-soon': return 'load-failed';
        default: return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'wake': return 'loading';
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
