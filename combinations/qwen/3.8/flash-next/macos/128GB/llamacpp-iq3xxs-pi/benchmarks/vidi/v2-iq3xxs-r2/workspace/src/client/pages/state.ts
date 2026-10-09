import type { BoardCheckResult } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * The two page state machines of story 5, as pure functions, straight out of the design's
 * state diagrams. `HomePage` and `BoardPage` hold one of these and dispatch events at it;
 * every arrow in the diagram is a case below, which is what makes the diagrams testable
 * (TC-16, TC-17, TC-19 to TC-21).
 */

/* --------------------------------- Home ---------------------------------- */

export type HomePageState =
  | { readonly stage: 'idle' }
  | { readonly stage: 'creating' }
  | { readonly stage: 'create_failed' };

export type HomeEvent =
  | { readonly type: 'create-started' }
  /** The 201 arrived: the page navigates, so this state is only passed through. */
  | { readonly type: 'created' }
  | { readonly type: 'create-failed' };

export const INITIAL_HOME_PAGE_STATE: HomePageState = { stage: 'idle' };

export function nextHomePageState(state: HomePageState, event: HomeEvent): HomePageState {
  switch (event.type) {
    case 'create-started':
      // Only from idle or from a failure: a second click cannot arrive while the first is
      // going because the button is disabled (`Creating…`).
      return state.stage === 'creating' ? state : { stage: 'creating' };
    case 'created':
      return { stage: 'idle' };
    case 'create-failed':
      return { stage: 'create_failed' };
  }
}

/* -------------------------------- Board --------------------------------- */

export type BoardPageState =
  /** Asking. `retries` counts the asks that failed to reach the service. */
  | { readonly stage: 'checking'; readonly retries: number }
  /** Reached the service and it says this board is not there (or the id is not a board). */
  | { readonly stage: 'not_found' }
  /** The service did not answer. The next retry is already scheduled. */
  | { readonly stage: 'unreachable'; readonly retries: number }
  /** The board exists: the story 1–4 board is mounted. */
  | { readonly stage: 'ready' };

export type BoardPageEvent =
  | { readonly type: 'check-started' }
  | { readonly type: 'check-result'; readonly result: BoardCheckResult };

/**
 * A board address whose id cannot be a board starts out `not_found` and sends no request
 * (`share.not_found`, TC-19): the server would answer 404 too, but there is no reason to
 * ask, and a person typing rubbish into an address bar should not create traffic.
 */
export function initialBoardPageState(boardId: string): BoardPageState {
  return isValidBoardId(boardId) ? { stage: 'checking', retries: 0 } : { stage: 'not_found' };
}

/**
 * Does this state still expect something to happen? A page in `checking` or `unreachable`
 * shows a message and waits; `ready` and `not_found` are settled, and nothing asks again.
 */
export function boardPageIsWaiting(state: BoardPageState): boolean {
  return state.stage === 'checking' || state.stage === 'unreachable';
}

/**
 * The message a waiting board page shows: "Opening board…" the first time, and "Couldn't
 * reach vidi6. Retrying…" from the first failure onwards (`share.unreachable`). Both live
 * in this function so the two branches of a retry cannot drift apart into two different
 * sentences.
 */
export function boardPageWaitingMessage(state: BoardPageState): string {
  const retries = state.stage === 'checking' || state.stage === 'unreachable' ? state.retries : 0;
  return retries === 0 ? OPENING_BOARD : UNREACHABLE_MESSAGE;
}

export const OPENING_BOARD = 'Opening board…';
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

export function nextBoardPageState(state: BoardPageState, event: BoardPageEvent): BoardPageState {
  switch (event.type) {
    case 'check-started':
      // A retry keeps the failure message on screen (`retries` does not go back to 0):
      // the person is still waiting for a service that is not answering, and flashing
      // "Opening board…" at them once a second would say the situation had changed when
      // it has not. `ready` and `not_found` are settled: nothing asks again.
      if (state.stage === 'ready' || state.stage === 'not_found') return state;
      return { stage: 'checking', retries: state.retries };
    case 'check-result':
      switch (event.result) {
        case 'exists':
          return { stage: 'ready' };
        case 'not_found':
          return { stage: 'not_found' };
        case 'unreachable':
          return { stage: 'unreachable', retries: retriesOf(state) + 1 };
      }
      break;
  }
}

/** How many asks have failed to reach the service so far. */
function retriesOf(state: BoardPageState): number {
  return state.stage === 'checking' || state.stage === 'unreachable' ? state.retries : 0;
}

/**
 * How long to wait before retry `retry` (0-based): `BOARD_CHECK_RETRY_BASE_MS`, doubled
 * each time, capped at story 3's `RECONNECT_MAX_BACKOFF_MS` — the same backoff the socket
 * uses, so one board does not knock on a struggling service twice as fast every second.
 */
export function boardCheckDelayMs(retry: number): number {
  const exponent = Math.max(0, Math.min(retry, 16));
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** exponent, RECONNECT_MAX_BACKOFF_MS);
}
