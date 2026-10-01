/** Room lifecycle (design: persist.room). `hibernated` and `storage-failed` both mean "doc not in memory". */
export type RoomLifecycle =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'load-failed'
  | 'storage-failed'
  | 'hibernated';

export type RoomEvent =
  | { type: 'loaded'; quarantined?: number }
  | { type: 'load-error' }
  | { type: 'update-stored' }
  | { type: 'compact-start' }
  | { type: 'compact-done' }
  | { type: 'compact-error' }
  | { type: 'append-failed' }
  | { type: 'sockets-closed' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'connect'; sinceFailureMs: number; retryAfterMs: number };

/** Pure transition function; an event that is not valid in `state` leaves it unchanged. */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-error') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'update-stored') return 'ready';
      if (event.type === 'compact-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'hibernate') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compact-done' || event.type === 'compact-error') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'sockets-closed' || event.type === 'connect') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake' || event.type === 'connect') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'connect' && event.sinceFailureMs >= event.retryAfterMs) return 'loading';
      return state;
  }
}
