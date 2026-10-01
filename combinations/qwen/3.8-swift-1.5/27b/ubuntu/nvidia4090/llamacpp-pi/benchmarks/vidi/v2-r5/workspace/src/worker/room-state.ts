// src/worker/room-state.ts
// Pure state transition function for the BoardRoom lifecycle.

export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed'; reason: string }
  | { type: 'update-stored' }
  | { type: 'compact-start' }
  | { type: 'compact-success' }
  | { type: 'compact-rollback' }
  | { type: 'storage-failed' }
  | { type: 'reload' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-eligible' };

export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success': return 'ready';
        case 'load-failed': return 'load-failed';
        default: return state;
      }

    case 'ready':
      switch (event.type) {
        case 'compact-start': return 'ready'; // compaction is a sub-state, room stays ready
        case 'compact-success': return 'ready';
        case 'compact-rollback': return 'ready';
        case 'storage-failed': return 'storage-failed';
        case 'hibernate': return 'hibernated';
        case 'wake': return 'loading';
        default: return state;
      }

    case 'load-failed':
      switch (event.type) {
        case 'retry-eligible': return 'loading';
        case 'wake': return 'loading';
        default: return state;
      }

    case 'storage-failed':
      switch (event.type) {
        case 'reload': return 'loading';
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
