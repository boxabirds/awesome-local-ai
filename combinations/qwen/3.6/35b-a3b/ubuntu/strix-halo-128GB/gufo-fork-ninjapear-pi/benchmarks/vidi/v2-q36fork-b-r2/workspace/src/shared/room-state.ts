import { LOAD_RETRY_MIN_INTERVAL_MS } from './config';

/** Unique symbol used to mark updates that originate from storage load */
export const LOAD_ORIGIN: unique symbol = Symbol('loadOrigin');

// All possible internal states (including transient ones)
export type RoomStateInternal = 'loading' | 'ready' | 'compacting' | 'storage-failed' | 'load-failed';

// External/public state
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export interface RoomLoadFailedInfo {
  failedAt: number; // timestamp when load failed
}

/**
 * Compute the next room state given current state and event.
 * Invalid events leave the state unchanged.
 * Covers every edge of the design's room lifecycle diagram plus invalid-event negatives.
 */
export function nextRoomState(
  state: RoomStateInternal,
  event: string,
  extra?: { now: number; failedAt?: number },
): RoomStateInternal {
  switch (state) {
    case 'loading':
      switch (event) {
        case 'load-ok':
        case 'load-ok-quarantined':
          return 'ready';
        case 'load-error':
        case 'sql-error':
          return 'load-failed';
        default:
          return state;
      }

    case 'ready':
      switch (event) {
        case 'append-success':
          return 'ready';
        case 'compact-request':
          return 'compacting';
        case 'append-failed':
          return 'storage-failed';
        default:
          return state;
      }

    case 'compacting':
      switch (event) {
        case 'compaction-ok':
        case 'compaction-rollback':
          return 'ready';
        default:
          return state;
      }

    case 'storage-failed':
      switch (event) {
        case 'reset-done':
          return 'loading';
        default:
          return state;
      }

    case 'load-failed': {
      if (extra && event === 'retry-after-interval' && extra.failedAt !== undefined) {
        const elapsed = extra.now - extra.failedAt;
        if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
          return 'loading';
        }
      }
      return state;
    }

    default:
      return state;
  }
}
