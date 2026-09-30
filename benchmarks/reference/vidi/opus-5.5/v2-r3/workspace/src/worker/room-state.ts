// Room lifecycle (design persist.room state diagram) as a pure transition function.
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomLifecycle = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'hibernated' | 'load-failed';

export type RoomEvent =
  /** Snapshot and log applied (`quarantined` log rows were set aside). */
  | { type: 'loaded'; quarantined: number }
  /** Snapshot unreadable or SQL error while loading. */
  | { type: 'load-error' }
  /** An update was applied, stored and broadcast. */
  | { type: 'update-stored' }
  | { type: 'compaction-start' }
  | { type: 'compaction-committed' }
  | { type: 'compaction-rolled-back' }
  /** Appending an update to storage threw. */
  | { type: 'append-failed' }
  /** No events for a while: the runtime may hibernate the object (sockets stay open). */
  | { type: 'idle' }
  /** A message or connection woke a hibernated object. */
  | { type: 'wake' }
  /** A new connection arrives; `sinceLoadFailureMs` is the time since the last failed load. */
  | { type: 'connection'; sinceLoadFailureMs: number };

/**
 * Next lifecycle state. Events that are not valid in `state` leave it unchanged.
 * A connection to a load-failed room triggers a reload only once
 * LOAD_RETRY_MIN_INTERVAL_MS has passed; before that it stays load-failed (and is
 * closed with CLOSE_BOARD_LOAD_FAILED).
 */
export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-error') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'update-stored') return 'ready';
      if (event.type === 'compaction-start') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'idle') return 'hibernated';
      return state;
    case 'compacting':
      if (event.type === 'compaction-committed' || event.type === 'compaction-rolled-back') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'connection') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return state;
    case 'load-failed':
      if (event.type === 'connection' && event.sinceLoadFailureMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}
