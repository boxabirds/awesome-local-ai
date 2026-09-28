// The BoardRoom lifecycle as a pure state machine, so every edge of the
// design.md lifecycle diagram is testable without a Durable Object runtime
// (TC-27). The room itself keeps exactly this state and asks this function for
// every transition; an event that is not legal for the current state leaves the
// state unchanged rather than throwing, because a stray event must never take
// a serving board down.
import { CLOSE_BOARD_LOAD_FAILED } from '../shared/protocol.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config.ts';

export type LifecycleState =
  | 'loading'
  | 'ready'
  | 'compacting'
  | 'load-failed'
  | 'storage-failed'
  | 'hibernated';

export type LifecycleEvent =
  /** storage read succeeded with no quarantined row */
  | { type: 'load-ok' }
  /** storage read succeeded but at least one update row was quarantined */
  | { type: 'load-ok-quarantined' }
  /** storage read failed (unparseable snapshot or SQL error) */
  | { type: 'load-error' }
  /** a client connection arrived while load-failed (elapsed since the failure) */
  | { type: 'connect'; elapsedMs: number }
  /** the compaction thresholds were crossed */
  | { type: 'compact-start' }
  /** snapshot + log trim committed */
  | { type: 'compact-ok' }
  /** compaction threw; the transaction rolled back and the board keeps serving */
  | { type: 'compact-failed' }
  /** a storage write failed after the connection was accepted */
  | { type: 'storage-error' }
  /** the object woke from hibernation / a connection asks to re-read storage */
  | { type: 'reload' }
  /** the last socket closed and the object became hibernation-eligible */
  | { type: 'hibernate' };

export interface LifecycleTransition {
  state: LifecycleState;
  /** Set when the transition into this state must close the connection. */
  closeCode: number | null;
}

function stay(state: LifecycleState): LifecycleTransition {
  return { state, closeCode: null };
}

function to(state: LifecycleState): LifecycleTransition {
  return { state, closeCode: null };
}

/**
 * The one legal transition for (state, event), or the unchanged state.
 *
 * `load-failed` is the interesting edge: a connection retries the load only
 * once LOAD_RETRY_MIN_INTERVAL_MS has passed since the failure - until then the
 * room stays `load-failed` and answers with the dedicated close code, so a
 * client that reconnects quickly can never hammer the failing storage read.
 */
export function nextLifecycleState(state: LifecycleState, event: LifecycleEvent): LifecycleTransition {
  switch (state) {
    case 'loading':
      if (event.type === 'load-ok' || event.type === 'load-ok-quarantined') return to('ready');
      if (event.type === 'load-error') return to('load-failed');
      return stay(state);

    case 'ready':
      if (event.type === 'compact-start') return to('compacting');
      if (event.type === 'storage-error') return to('storage-failed');
      if (event.type === 'hibernate') return to('hibernated');
      return stay(state);

    case 'compacting':
      // Both outcomes land back in ready: a failed compaction is rolled back.
      if (event.type === 'compact-ok' || event.type === 'compact-failed') return to('ready');
      return stay(state);

    case 'load-failed': {
      if (event.type !== 'connect') return stay(state);
      if (event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return to('loading');
      return { state: 'load-failed', closeCode: CLOSE_BOARD_LOAD_FAILED };
    }

    case 'storage-failed':
      // The doc was discarded and every socket closed; the next connection
      // re-reads the last durable state.
      if (event.type === 'reload') return to('loading');
      return stay(state);

    case 'hibernated':
      if (event.type === 'reload') return to('loading');
      return stay(state);

    default:
      return stay(state as LifecycleState);
  }
}

/** The three states a client can observe; the extra lifecycle states are all 'ready'. */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export function roomState(state: LifecycleState): RoomState {
  if (state === 'load-failed') return 'load-failed';
  if (state === 'storage-failed') return 'storage-failed';
  return 'ready';
}
