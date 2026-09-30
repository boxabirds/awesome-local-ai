import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/**
 * The page state machines from design.md, as data. The pages render straight
 * from these; the transitions are pure so they can be read (and reasoned about)
 * apart from React. The exact user-facing copy lives here too, since a state and
 * its message are one thing (PRD: the message is part of the requirement).
 */

export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";
export const CHECKING_COPY = 'Opening board…';
export const UNREACHABLE_COPY = "Couldn't reach vidi6. Retrying…";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** The wait before retry number `attempt` (1-indexed) — the base doubled for
 * each failure, capped at the same ceiling story 3's reconnect uses. */
export const checkRetryDelayMs = (attempt: number): number =>
  Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS);

/**
 * Where the board page goes after a check came back. `attempt` is the 1-indexed
 * number of the check that produced `result`, so the next wait doubles with each
 * unreachable answer. `boardId` rides along into `ready` because it is the board
 * this page is about.
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      // A definite "there is no such board" — stop asking, show not found.
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: checkRetryDelayMs(attempt) };
  }
}
