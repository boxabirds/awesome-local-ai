/**
 * Room state machine: pure transition function for the BoardRoom lifecycle.
 *
 * States: loading, ready, compacting, storage-failed, hibernated, load-failed.
 * The function is pure: given a state and an event, it returns the next state.
 * Invalid events for a state leave it unchanged.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export type RoomState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

export type RoomEvent =
  | { type: 'load-success' }
  | { type: 'load-failed' }
  | { type: 'update-stored' }
  | { type: 'compaction-start' }
  | { type: 'compaction-success' }
  | { type: 'compaction-rollback' }
  | { type: 'storage-failed' }
  | { type: 'reset' }
  | { type: 'hibernate' }
  | { type: 'wake' }
  | { type: 'retry'; elapsedMs: number };

/**
 * Compute the next room state given the current state and an event.
 * Invalid events leave the state unchanged.
 */
export function nextRoomState(state: RoomState, event: RoomEvent): RoomState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-success':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }

    case 'ready':
      switch (event.type) {
        case 'update-stored':
          return 'ready';
        case 'compaction-start':
          return 'compacting';
        case 'storage-failed':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }

    case 'compacting':
      switch (event.type) {
        case 'compaction-success':
          return 'ready';
        case 'compaction-rollback':
          return 'ready';
        default:
          return state;
      }

    case 'storage-failed':
      switch (event.type) {
        case 'reset':
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

    case 'load-failed':
      switch (event.type) {
        case 'retry':
          if (event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) {
            return 'loading';
          }
          return 'load-failed';
        default:
          return state;
      }

    default:
      return state;
  }
}
