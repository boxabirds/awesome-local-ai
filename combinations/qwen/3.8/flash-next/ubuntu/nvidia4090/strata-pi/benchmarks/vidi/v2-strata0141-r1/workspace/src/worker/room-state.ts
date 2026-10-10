/**
 * Room lifecycle (anchor `persist.room`).
 *
 * The room lifecycle diagram of the design, as a pure transition table. Keeping
 * it pure is what makes the failure rules testable without a Durable Object:
 * a room that is holding a load failure must not reload a board on every
 * reconnecting client, and a room that is mid-compaction must not forget the
 * log it is about to truncate.
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Loading
 *     Loading --> Ready : load-succeeded / load-quarantined
 *     Loading --> LoadFailed : load-failed
 *     Ready --> Compacting : compact-start
 *     Compacting --> Ready : compact-succeeded / compact-failed
 *     Ready --> StorageFailed : storage-failed
 *     StorageFailed --> Loading : reload
 *     Ready --> Hibernated : hibernate
 *     Hibernated --> Loading : wake
 *     LoadFailed --> Loading : retry-load (after LOAD_RETRY_MIN_INTERVAL_MS)
 *     LoadFailed --> LoadFailed : retry-load (before it: close 4500)
 * ```
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../shared/protocol';

/** Every state the room lifecycle can be in. */
export type RoomLifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'load-failed'
  | 'storage-failed'
  | 'hibernated';

/** Every event the room lifecycle reacts to. */
export type RoomEvent =
  /** Snapshot and log applied (or applied with rows quarantined). */
  | 'load-succeeded'
  | 'load-quarantined'
  /** Snapshot unreadable, or the read itself failed. */
  | 'load-failed'
  /** The log passed a compaction threshold. */
  | 'compact-start'
  | 'compact-succeeded'
  /** Compaction rolled back: the previous snapshot and log are intact. */
  | 'compact-failed'
  /** A write failed: the room cannot serve what it cannot save. */
  | 'storage-failed'
  /** The next connection reloads a room that failed to write. */
  | 'reload'
  /** Nothing to do: the object may hibernate with its sockets open. */
  | 'hibernate'
  /** A message or a new connection woke a hibernated object. */
  | 'wake'
  /** A client arrived at a room that could not load its board. */
  | 'retry-load';

/**
 * A transition.
 *
 * `closeCode` is what a newly accepted socket must be closed with when the
 * event is refused (`null` when there is nothing to refuse), `changed` says
 * whether the room moved at all.
 */
export interface RoomTransition {
  readonly state: RoomLifecycleState;
  readonly closeCode: number | null;
  readonly changed: boolean;
}

/** Timing context: how long this room has been unable to load its board. */
export interface RoomClock {
  readonly sinceFailedMs: number;
}

const TRANSITIONS: Record<RoomLifecycleState, Partial<Record<RoomEvent, RoomLifecycleState>>> = {
  loading: {
    'load-succeeded': 'ready',
    'load-quarantined': 'ready',
    'load-failed': 'load-failed',
  },
  ready: {
    'compact-start': 'compacting',
    'storage-failed': 'storage-failed',
    hibernate: 'hibernated',
  },
  compacting: {
    'compact-succeeded': 'ready',
    'compact-failed': 'ready',
  },
  // LoadFailed is handled in `nextRoomState`: whether it retries depends on the
  // clock, not on the event alone.
  'load-failed': {},
  'storage-failed': { reload: 'loading' },
  hibernated: { wake: 'loading' },
};

const held = (state: RoomLifecycleState, closeCode: number | null = null): RoomTransition => ({
  state,
  closeCode,
  changed: false,
});

const moved = (state: RoomLifecycleState): RoomTransition => ({
  state,
  closeCode: null,
  changed: true,
});

/**
 * The next state for `event`, or `state` unchanged when this state does not
 * react to this event.
 *
 * The only timed edge is `LoadFailed --retry-load-->`: retrying the load of a
 * board that just failed costs compute on every reconnecting client, so it is
 * allowed at most once per LOAD_RETRY_MIN_INTERVAL_MS. Until then the client is
 * closed with CLOSE_BOARD_LOAD_FAILED, which is what keeps it retrying.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
  clock: RoomClock,
): RoomTransition {
  if (event === 'retry-load') {
    if (state === 'load-failed') {
      return clock.sinceFailedMs >= LOAD_RETRY_MIN_INTERVAL_MS
        ? moved('loading')
        : held(state, CLOSE_BOARD_LOAD_FAILED);
    }
    return held(state);
  }

  const next = TRANSITIONS[state]?.[event];
  return next === undefined ? held(state) : moved(next);
}
