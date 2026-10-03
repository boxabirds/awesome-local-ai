// Room state machine for the persistent BoardRoom Durable Object.
// Pure function: nextRoomState(state, event) → new state.

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'hibernated';

export type RoomEvent =
  | { type: 'load-success'; quarantined: number }
  | { type: 'load-failed'; reason: string }
  | { type: 'update-stored' }
  | { type: 'compaction-start' }
  | { type: 'compaction-success' }
  | { type: 'compaction-rollback' }
  | { type: 'storage-failed' }
  | { type: 'hibernate' }
  | { type: 'wake'; now: number }
  | { type: 'retry-load'; now: number; lastFailedAt: number };

/**
 * Pure state transition function for the room lifecycle.
 * Returns the next state given the current state and an event.
 * Invalid events leave the state unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent, lastLoadFailedAt?: number): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state; // invalid events leave state unchanged
      }

    case 'ready':
      switch (event.type) {
        case 'update-stored':
          return 'ready';
        case 'compaction-start':
          return 'ready'; // compaction is sub-state, stays ready
        case 'compaction-success':
          return 'ready';
        case 'compaction-rollback':
          return 'ready';
        case 'storage-failed':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }

    case 'load-failed':
      switch (event.type) {
        case 'wake':
        case 'retry-load': {
          const lastAt = event.type === 'retry-load' ? event.lastFailedAt : lastLoadFailedAt;
          if (lastAt === undefined) return 'loading';
          if (event.now - lastAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
            return 'loading';
          }
          return 'load-failed'; // too soon, stay
        }
        default:
          return state;
      }

    case 'storage-failed':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    case 'hibernated':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }

    default:
      return state;
  }
}
