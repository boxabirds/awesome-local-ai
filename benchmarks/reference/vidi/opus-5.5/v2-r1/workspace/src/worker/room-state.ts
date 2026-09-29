// Lifecycle of a board room (design: persist.room state diagram), as a pure transition function.
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState =
  | { name: 'loading' }
  | { name: 'ready' }
  | { name: 'compacting' }
  | { name: 'storage-failed' }
  | { name: 'hibernated' }
  /** `failedAt`: epoch ms of the last failed load attempt. */
  | { name: 'load-failed'; failedAt: number };

export type RoomEvent =
  /** Snapshot and log applied (`quarantined` damaged log rows skipped). */
  | { type: 'loaded'; quarantined: number }
  /** Snapshot unreadable or SQL error while loading. */
  | { type: 'load-failed'; at: number }
  /** The log reached its compaction threshold after an append. */
  | { type: 'compaction-started' }
  /** Snapshot replaced and log truncated, or failure rolled back (log intact): ready either way. */
  | { type: 'compaction-finished'; ok: boolean }
  /** Storing an update threw. */
  | { type: 'append-failed' }
  /** A new WebSocket connection arrives at `at`. */
  | { type: 'connection'; at: number }
  /** No events for a while: the runtime may hibernate the object (sockets may stay open). */
  | { type: 'idle' }
  /** A message or connection wakes a hibernated object (it is reconstructed and reloads). */
  | { type: 'wake' };

/** Next state for `event`; events that are invalid in `state` leave it unchanged. */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state.name) {
    case 'loading':
      if (event.type === 'loaded') return { name: 'ready' };
      if (event.type === 'load-failed') return { name: 'load-failed', failedAt: event.at };
      return state;
    case 'ready':
      if (event.type === 'compaction-started') return { name: 'compacting' };
      if (event.type === 'append-failed') return { name: 'storage-failed' };
      if (event.type === 'idle') return { name: 'hibernated' };
      return state;
    case 'compacting':
      if (event.type === 'compaction-finished') return { name: 'ready' };
      return state;
    case 'storage-failed':
      // The doc was discarded; the next connection reloads it from storage.
      if (event.type === 'connection') return { name: 'loading' };
      return state;
    case 'hibernated':
      if (event.type === 'wake') return { name: 'loading' };
      return state;
    case 'load-failed':
      if (event.type === 'connection' && event.at - state.failedAt >= LOAD_RETRY_MIN_INTERVAL_MS)
        return { name: 'loading' };
      return state;
  }
}
