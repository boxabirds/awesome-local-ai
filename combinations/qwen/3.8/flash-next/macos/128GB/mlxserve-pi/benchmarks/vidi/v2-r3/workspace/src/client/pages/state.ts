// The Home and Board pages' state machines as plain data and one pure
// transition (share.pages). Keeping the states here — rather than scattered
// through the components — is what makes every edge of the two page state
// diagrams a thing a component test can drive with a mocked `api.ts` (the
// design's Test scopes): the states and their exact copy are defined once.
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/**
 * The Home page. `create_failed` carries the exact PRD copy (share.create_failure)
 * as part of its type, so the message the page shows is the message the PRD names.
 */
export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

/** The one failure message the Home page ever shows (share.create_failure). */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/** The board page's loading copy (share.open_link). */
export const OPENING_BOARD_MESSAGE = 'Opening board\u2026';

/** The board page's unreachable copy (share.unreachable). */
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying\u2026";

/**
 * The Board page. `unreachable` carries how many attempts have failed and how
 * long until the next retry, so the backoff is inspectable and testable rather
 * than a timer a test cannot see.
 */
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * The wait before the retry that follows `attempt` failed attempts: exponential
 * from BOARD_CHECK_RETRY_BASE_MS (1 s, 2 s, 4 s …) and capped at
 * RECONNECT_MAX_BACKOFF_MS, the same ceiling the live connection uses. `attempt`
 * is 0 for the first failure.
 */
export function boardCheckBackoffMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The next Board page state for a check outcome. `attempt` is the number of
 * consecutive unreachable outcomes so far (0 on the first check).
 *
 * `exists` becomes `ready`; the caller fills in the real board id (this function
 * does not hold one — it is only the transition the state diagram draws).
 * `not_found` and `unreachable` are the two outcomes the page must not paper
 * over: one says the board is gone, the other says the service is not reachable
 * and promises a retry (share.not_found, share.unreachable).
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): Exclude<BoardPageState, { kind: 'checking' }> {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt: attempt + 1, nextRetryMs: boardCheckBackoffMs(attempt) };
  }
}
