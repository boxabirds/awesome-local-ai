/**
 * Story 4: pure room lifecycle state machine.
 *
 * Mirrors the design's room lifecycle diagram exactly. The room keeps one of
 * the six lifecycle states; `nextRoomState` is a pure transition function so
 * every edge (including the LoadFailed retry interval and the "invalid event
 * leaves the state unchanged" negatives) can be unit-tested in isolation.
 *
 *   [*] --> Loading : object constructed or woken
 *   Loading --> Ready : snapshot and log applied (quarantined or not)
 *   Loading --> LoadFailed : snapshot unreadable or SQL error
 *   Ready --> Ready : update applied, stored, broadcast
 *   Ready --> Compacting : log exceeds threshold
 *   Compacting --> Ready : snapshot replaced, log truncated (success)
 *   Compacting --> Ready : compaction error rolled back, log intact
 *   Ready --> StorageFailed : insert throws
 *   StorageFailed --> Loading : sockets closed, doc discarded, next connection
 *   Ready --> Hibernated : no events (sockets may stay open)
 *   Hibernated --> Loading : message or new connection wakes the object
 *   LoadFailed --> Loading : new connection after LOAD_RETRY_MIN_INTERVAL_MS
 *   LoadFailed --> LoadFailed : connection before the interval (close 4500)
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from 'src/shared/config';

export type RoomLifecycle =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated'
  | 'load-failed';

/** The resting states the contract exposes for the connection gate. */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export type RoomEventType =
  | 'loaded'
  | 'load-failed'
  | 'update-stored'
  | 'compact-start'
  | 'compact-finished'
  | 'compact-rolled-back'
  | 'storage-failed'
  | 'hibernate'
  | 'wake'
  | 'connection-attempt';

export interface RoomEvent {
  type: RoomEventType;
  /** `connection-attempt` only: current time (ms). */
  now?: number;
  /** `connection-attempt` only: last load-attempt time (ms). */
  lastAttemptAt?: number;
}

export function nextRoomState(state: RoomLifecycle, event: RoomEvent): RoomLifecycle {
  switch (state) {
    case 'loading':
      if (event.type === 'loaded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return state;

    case 'ready':
      switch (event.type) {
        case 'update-stored':
          return 'ready';
        case 'compact-start':
          return 'compacting';
        case 'storage-failed':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }

    case 'compacting':
      if (event.type === 'compact-finished' || event.type === 'compact-rolled-back') {
        return 'ready';
      }
      return state;

    case 'storage-failed':
      if (event.type === 'wake') return 'loading';
      return state;

    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return state;

    case 'load-failed':
      if (event.type === 'connection-attempt') {
        const elapsed = (event.now ?? 0) - (event.lastAttemptAt ?? 0);
        return elapsed >= LOAD_RETRY_MIN_INTERVAL_MS ? 'loading' : 'load-failed';
      }
      return state;

    default:
      return state;
  }
}

/** Maps a lifecycle state to the resting state the connection gate uses. */
export function restingState(state: RoomLifecycle): RoomState {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'load-failed':
      return 'load-failed';
    case 'storage-failed':
      return 'storage-failed';
    default:
      // Transient (loading/compacting/hibernated) is treated as ready for the
      // gate: the doc is present and serving.
      return 'ready';
  }
}
