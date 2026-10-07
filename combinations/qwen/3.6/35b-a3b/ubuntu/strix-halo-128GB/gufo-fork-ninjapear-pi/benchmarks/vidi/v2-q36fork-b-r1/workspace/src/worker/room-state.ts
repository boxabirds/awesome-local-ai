/**
 * Room state transitions — pure function for BoardRoom lifecycle.
 * Story 4 — persistence.
 *
 * Valid events per state are defined by the state diagram in design.md.
 * Invalid events leave the current state unchanged.
 */
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';

export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

// Transient states used internally but not exposed externally.
type InternalState = RoomState | '_loading' | '_compacting' | '_hibernated';

/**
 * An event that can cause a state transition.
 */
export type RoomEvent =
  | { kind: 'load-ok' }                              // Loading → Ready
  | { kind: 'load-ok-quarantined'; quarantined: number } // Loading → Ready (with quarantine count)
  | { kind: 'load-error-reason'; reason: string }     // Loading → LoadFailed
  | { kind: 'load-error-sql' }                        // Loading → LoadFailed (SQL error)
  | { kind: 'append-success' }                        // Ready → Compacting
  | { kind: 'compact-ok' }                            // Compacting → Ready
  | { kind: 'compact-failed' }                        // Compacting → Ready (no change to log)
  | { kind: 'append-error' }                          // Ready → StorageFailed
  | { kind: 'socket-closed' }                         // StorageFailed → Loading
  | { kind: 'new-connection' };                       // LoadFailed → attempt reload; Hibernated → Loading

interface TransitionMap {
  [state: string]: { [event: string]: InternalState };
}

const TRANSITIONS: TransitionMap = {
  _loading: {
    'load-ok': 'ready',
    'load-ok-quarantined': 'ready',
    'load-error-reason': 'load-failed',
    'load-error-sql': 'load-failed',
  },
  ready: {
    'append-success': '_compacting',
  },
  _compacting: {
    'compact-ok': 'ready',
    'compact-failed': 'ready',
  },
  'load-failed': {},
  'storage-failed': {
    'socket-closed': '_loading',
  },
};

/**
 * Compute the next room state given the current state and an event.
 * Returns the new state, or the same state if the event is invalid.
 * For transient states (_loading, _compacting), only valid transitions apply.
 */
export function nextRoomState(
  currentState: InternalState,
  event: RoomEvent,
): InternalState {
  const rules = TRANSITIONS[currentState];
  if (!rules) return currentState; // unknown state → stay

  const rule = rules[event.kind];
  if (rule === undefined) return currentState; // invalid event → stay
  return rule;
}

/**
 * Determine whether a `load-failed` room should retry loading based on
 * time elapsed since the failure was recorded.
 *
 * This is a pure gate function; the actual timestamp tracking lives
 * in the room instance.
 */
export function canRetryLoad(elapsedMs: number): boolean {
  return elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS;
}
