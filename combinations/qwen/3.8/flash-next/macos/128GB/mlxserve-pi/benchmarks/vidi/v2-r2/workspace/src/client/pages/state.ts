// The two page state machines of story 5, as plain values.
//
// They live here rather than inside the components because the interesting parts -
// what a failed creation does to the button, how long to wait before the next retry,
// which answers are final - are decisions, not rendering, and a test should be able
// to point at them. The components below hold one of these in `useState` and render
// it; nothing else computes.

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/** Shown under the New board button when a board could not be made. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/** Shown in place of the board while the service cannot be reached. */
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

/** Shown in place of the board while the link is being checked. */
export const OPENING_MESSAGE = 'Opening board…';

/** The home page: idle, making a board, or explaining why it did not. */
export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

/** A board link: unchecked, checked-and-there, checked-and-absent, or unanswered. */
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** What the board page starts with: a check is already on its way. */
export function initialBoardPageState(): BoardPageState {
  return { kind: 'checking' };
}

/**
 * What the board page does with an answer.
 *
 * `attempt` counts the checks that have come back unanswered, this one included -
 * so the first failure waits `BOARD_CHECK_RETRY_BASE_MS` and the second twice that.
 * `boardId` is what `ready` records: the only board this page could ever be ready
 * for is the one in its own address.
 *
 * `not_found` and `ready` are final. A link that the service says does not exist
 * does not come back because the page asked again, and a page that re-asked after
 * a person got to a board would be a board that disappears under them.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  if (state.kind === 'ready' || state.kind === 'not_found') return state;

  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      // Said once and believed: this answer came from the service, not from a
      // failure to reach it, so there is nothing to retry.
      return { kind: 'not_found' };
    case 'unreachable':
      return {
        kind: 'unreachable',
        attempt,
        // The same doubling the socket uses (story 3), from the same ceiling, so
        // "retrying" costs the service less the longer it goes on.
        nextRetryMs: Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS),
      };
  }
}
