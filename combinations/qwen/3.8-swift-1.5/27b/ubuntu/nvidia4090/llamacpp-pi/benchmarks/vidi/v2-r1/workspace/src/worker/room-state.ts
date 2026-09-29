export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'compacting' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success' }
  | { type: 'load-failed'; error: string }
  | { type: 'update-stored' }
  | { type: 'compaction-start' }
  | { type: 'compaction-success' }
  | { type: 'compaction-failed' }
  | { type: 'storage-failed' }
  | { type: 'socket-closed' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry-load' };

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
        case 'compaction-start': return 'compacting';
        case 'storage-failed': return 'storage-failed';
        case 'hibernate': return 'hibernated';
        case 'update-stored': return 'ready';
        default: return state;
      }
    case 'load-failed':
      switch (event.type) {
        case 'retry-load': return 'loading';
        default: return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'socket-closed': return 'loading';
        default: return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compaction-success': return 'ready';
        case 'compaction-failed': return 'ready';
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
