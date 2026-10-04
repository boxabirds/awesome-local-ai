/**
 * Pure state machine for the BoardRoom lifecycle (story 4).
 *
 * Models the design's room state diagram:
 *   Loading → Ready (load applied, also when rows were quarantined)
 *   Loading → LoadFailed (snapshot unreadable or SQL error)
 *   Ready → Ready (update applied, stored, broadcast)
 *   Ready → Compacting → Ready (snapshot replaced / log truncated,
 *             or compaction error rolled back with log intact)
 *   Ready → StorageFailed (insert throws; sockets closed, doc discarded)
 *   StorageFailed → Loading (next connection wakes the object)
 *   Ready → Hibernated → Loading (no events; message or connection wakes)
 *   LoadFailed → Loading (new connection after LOAD_RETRY_MIN_INTERVAL_MS)
 *   LoadFailed → LoadFailed (connection before the interval: closed 4500)
 *
 * Invalid events for a state leave the state unchanged.
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState =
  | { name: 'loading' }
  | { name: 'ready' }
  | { name: 'compacting' }
  | { name: 'storage-failed' }
  | { name: 'hibernated' }
  | { name: 'load-failed'; sinceMs: number };

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed'; atMs: number }
  | { type: 'update' }
  | { type: 'compact-start' }
  | { type: 'compact-success' }
  | { type: 'compact-failed' }
  | { type: 'storage-failed' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'connection'; nowMs: number };

/**
 * Compute the next room state for a (state, event) pair.
 * Invalid events for a state return the state unchanged (same object).
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state.name) {
    case 'loading':
      if (event.type === 'load-success') return { name: 'ready' };
      if (event.type === 'load-failed') return { name: 'load-failed', sinceMs: event.atMs };
      return state;

    case 'ready':
      if (event.type === 'update') return { name: 'ready' };
      if (event.type === 'compact-start') return { name: 'compacting' };
      if (event.type === 'storage-failed') return { name: 'storage-failed' };
      if (event.type === 'hibernate') return { name: 'hibernated' };
      return state;

    case 'compacting':
      if (event.type === 'compact-success' || event.type === 'compact-failed') {
        return { name: 'ready' };
      }
      return state;

    case 'storage-failed':
      if (event.type === 'wake') return { name: 'loading' };
      return state;

    case 'hibernated':
      if (event.type === 'wake') return { name: 'loading' };
      return state;

    case 'load-failed':
      if (
        event.type === 'connection' &&
        event.nowMs - state.sinceMs >= LOAD_RETRY_MIN_INTERVAL_MS
      ) {
        return { name: 'loading' };
      }
      return state;
  }
}
