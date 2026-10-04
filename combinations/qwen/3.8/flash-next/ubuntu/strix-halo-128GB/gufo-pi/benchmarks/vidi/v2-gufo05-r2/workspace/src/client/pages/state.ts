/**
 * The two page state machines story 5 adds, as functions of state and event
 * (design §2) — which is what makes them testable without a browser: every state
 * below is one sentence about what the person sees, and every transition is a call.
 *
 * There are two because a page that opens a link has two things that can go wrong,
 * and they are not the same thing: a board that was never created (say so once) and
 * a service that did not answer (say so, and try again, quietly).
 */

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/** What the home page shows (share.create, share.create_failure). */
export type HomeState =
  | { kind: 'idle' }
  /** Between the click and the answer: the button says so and cannot be clicked twice. */
  | { kind: 'creating' }
  /** Nothing was opened at any link. Plain words, and the same button still there. */
  | { kind: 'create_failed'; message: string };

export type HomeEvent = { type: 'clicked' } | { type: 'created' } | { type: 'failed' };

/** PRD share.create_failure, in the words the design gives it. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

export function nextHomeState(state: HomeState, event: HomeEvent): HomeState {
  switch (event.type) {
    case 'clicked':
      // Only from idle-or-failed: a click while creating is not queued, because a
      // second board would be a board nobody meant to open.
      return state.kind === 'creating' ? state : { kind: 'creating' };
    case 'created':
      return { kind: 'idle' };
    case 'failed':
      return { kind: 'create_failed', message: CREATE_FAILED_MESSAGE };
  }
}

/** What the board page shows while it finds out whether this is one of ours. */
export type BoardPageState =
  /** The first question is already asked; the board skeleton is on screen. */
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  /** Nobody ever created this board, and nobody will from this page. */
  | { kind: 'not_found' }
  /**
   * The service could not be reached. `attempt` is how many times it has been asked
   * (so the copy can be honest about it), and `nextRetryMs` is how long the page
   * waits before asking again — nobody presses a Retry button to find out whether a
   * network came back.
   */
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * What the board page shows once an existence check has answered.
 *
 * `attempt` counts the checks made so far, this one included (1 for the first).
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      // A board already on screen stays on screen. The page is not going to blank
      // somebody's work because one check did not answer; the connection layer
      // handles a board that stops syncing, which is the case this would be.
      return state.kind === 'ready'
        ? state
        : { kind: 'unreachable', attempt, nextRetryMs: boardCheckDelayMs(attempt) };
  }
}

/**
 * How long to wait after the nth unanswered check: 1 s, 2 s, 4 s, up to the same
 * ceiling the sockets back off to (PRD share.unreachable: doubling, with a first
 * retry within 2 s of the failure).
 */
export function boardCheckDelayMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_MAX_BACKOFF_MS);
}
