import { BOARD_CHECK_RETRY_BASE_MS } from '../../shared/config';
import type { CheckResult } from '../api';

/**
 * The two pages' state, kept apart from the components so the rules they follow
 * are testable on their own (`share.open_link`, `share.create_failure`).
 *
 * Only the *shape* of a page's state is described here. Every message a page can
 * show is one of the literals below - the design names each one and the tests
 * assert them verbatim, so a message is a contract, not a wording choice.
 */

/* --- home (`share.create`, `share.create_failure`) ---------------------- */

export const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";

export type HomePageState =
  /** Showing the New board button, waiting for a click. */
  | { kind: 'idle' }
  /** The request is in flight; the button is disabled and cannot be repeated. */
  | { kind: 'creating' }
  /** The server refused, or never answered. */
  | { kind: 'create_failed'; message: typeof CREATE_FAILURE_MESSAGE };

/** Clicking New board. There is no other way into a board. */
export function nextHomePageState(): HomePageState {
  return { kind: 'creating' };
}

/** What the create request answered. A created board is a navigation, not a state. */
export function homePageStateAfterCreate(result: { kind: 'created' } | { kind: 'failed' }): HomePageState {
  return result.kind === 'created'
    ? { kind: 'creating' } // the page is on its way to the board; stay disabled
    : { kind: 'create_failed', message: CREATE_FAILURE_MESSAGE };
}

/* --- board page (`share.open_link`, `share.not_found`) ------------------ */

export const OPENING_MESSAGE = 'Opening board…';
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

export type BoardPageState =
  /** Checking, or re-checking. */
  | { kind: 'checking'; boardId: string }
  /** The board exists. The board itself is shown. */
  | { kind: 'ready'; boardId: string }
  /** This address names no board. */
  | { kind: 'not_found' }
  /** The service did not answer. This is shown as a failure, not as "not found". */
  | { kind: 'unreachable'; boardId: string; attempt: number; nextRetryMs: number };

export function initialBoardPageState(boardId: string): BoardPageState {
  return { kind: 'checking', boardId };
}

/**
 * How long to wait before retry number `attempt` (1-based): 1s, then 2s, then 4s,
 * capped at 8s. Only a failure to reach the service is retried - a 404 is an
 * answer, and answering it twice would change nothing (`share.open_link`).
 */
export function boardCheckRetryDelayMs(attempt: number): number {
  const capped = Math.min(attempt, 4);
  return BOARD_CHECK_RETRY_BASE_MS * 2 ** (capped - 1);
}

/**
 * The state after one existence check.
 *
 * `attempt` is how many checks this page has made in a row, including this one.
 */
export function nextBoardPageState(
  boardId: string,
  result: CheckResult,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return {
        kind: 'unreachable',
        boardId,
        attempt,
        nextRetryMs: boardCheckRetryDelayMs(attempt),
      };
  }
}
