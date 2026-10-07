import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/**
 * The page state machines of story 5 (design "State diagrams"). They live here,
 * apart from the components, so the Home and Board page transitions are testable
 * without a DOM — and so the copy that the PRD fixes word for word appears exactly
 * once.
 */

/** What the home page shows, next to the New board button. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/** What the board page shows while the link is being checked. */
export const OPENING_BOARD_MESSAGE = 'Opening board…';

/** What the board page shows when the service could not be reached (PRD share.unreachable). */
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

/** What the board-not-found page says (PRD share.not_found). */
export const NOT_FOUND_HEADING = 'Board not found';
export const NOT_FOUND_MESSAGE = 'Check the link, or ask the person who shared it to send it again.';

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  /** `attempt`: checks made so far; `nextRetryMs`: how long until the next one. */
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** The home page's transitions (design state diagram "Home page"). */
export function nextHomePageState(
  state: HomePageState,
  event: { type: 'click' } | { type: 'created' } | { type: 'failed' },
): HomePageState {
  switch (event.type) {
    case 'click':
      // Only from idle: the button is disabled while a creation is under way.
      return state.kind === 'idle' ? { kind: 'creating' } : state;
    case 'created':
      return { kind: 'idle' }; // the page is left behind; the button is ready if returned to
    case 'failed':
      return { kind: 'create_failed', message: CREATE_FAILED_MESSAGE };
  }
}

/** Exponential backoff for link checks: BASE, 2×BASE, 4×BASE … capped. */
export function boardCheckRetryMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The board page's next state after a link check answered (design state diagram
 * "Board page"). `attempt` is how many checks were made before this one, so the
 * first retry waits `BOARD_CHECK_RETRY_BASE_MS` and the second twice that
 * (TC-21's boundary). A page that is already `ready` never goes backwards.
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
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt: attempt + 1, nextRetryMs: boardCheckRetryMs(attempt) };
  }
}
