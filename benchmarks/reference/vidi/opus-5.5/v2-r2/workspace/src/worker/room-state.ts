// Board room lifecycle (design persist.room state diagram) as a pure transition function.
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomLifecycleState = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'load-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-succeeded'; quarantined: number }
  | { type: 'load-failed' }
  | { type: 'update-stored' }
  | { type: 'compaction-started' }
  | { type: 'compaction-finished' }
  | { type: 'compaction-rolled-back' }
  | { type: 'append-failed' }
  | { type: 'idle' }
  | { type: 'wake' }
  /** A new WebSocket connection; `msSinceLoadFailure` matters only in `load-failed`. */
  | { type: 'connection'; msSinceLoadFailure?: number };

/** The next room state; an event that is not valid in `state` leaves it unchanged. */
export function nextRoomState(state: RoomLifecycleState, event: RoomEvent): RoomLifecycleState {
  switch (state) {
    case 'loading':
      if (event.type === 'load-succeeded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'update-stored') return 'ready';
      if (event.type === 'compaction-started') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'idle') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compaction-finished' || event.type === 'compaction-rolled-back') return 'ready';
      return state;
    case 'storage-failed':
      // The doc was discarded; the next connection reloads it from storage.
      return event.type === 'connection' ? 'loading' : state;
    case 'hibernated':
      return event.type === 'wake' || event.type === 'connection' ? 'loading' : state;
    case 'load-failed':
      if (event.type !== 'connection') return state;
      return (event.msSinceLoadFailure ?? 0) >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
  }
}
