// The BoardRoom lifecycle as a pure transition function (design: room lifecycle state diagram).
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type LifecycleState = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'hibernated' | 'load-failed';

export type RoomEvent =
  /** Snapshot and log applied; `quarantined` damaged log rows were set aside. */
  | { type: 'loaded'; quarantined: number }
  /** Snapshot unreadable or SQL error while loading. */
  | { type: 'load-failed' }
  /** The log reached a compaction threshold. */
  | { type: 'compaction-started' }
  /** Compaction committed (`committed`) or failed and rolled back with the log intact. */
  | { type: 'compaction-finished'; committed: boolean }
  /** Storing an update threw: sockets are closed and the doc is discarded. */
  | { type: 'append-failed' }
  /** No events for a while; the runtime may evict the object (sockets may stay open). */
  | { type: 'idle' }
  /** A message on a hibernated socket woke the object. */
  | { type: 'wake' }
  /** A new WebSocket connection at time `now`; `failedAt` is when the last load failed. */
  | { type: 'connect'; now: number; failedAt: number };

/** The next lifecycle state. Events that do not apply to `state` leave it unchanged. */
export function nextRoomState(state: LifecycleState, event: RoomEvent): LifecycleState {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;
    case 'ready':
      if (event.type === 'compaction-started') return 'compacting';
      if (event.type === 'append-failed') return 'storage-failed';
      if (event.type === 'idle') return 'hibernated';
      return state;
    case 'compacting':
      // Committed or rolled back, the room keeps serving (a rolled-back compaction leaves the log intact).
      if (event.type === 'compaction-finished') return 'ready';
      return state;
    case 'storage-failed':
      if (event.type === 'connect') return 'loading';
      return state;
    case 'hibernated':
      if (event.type === 'wake' || event.type === 'connect') return 'loading';
      return state;
    case 'load-failed':
      // Retrying the load on every connection would hammer a broken board; retry at most once per interval.
      if (event.type === 'connect' && event.now - event.failedAt >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return state;
  }
}
