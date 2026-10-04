/**
 * Page state machines (story 5) — pure helpers shared by the pages and
 * their component tests.
 */
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import type { CheckResponse } from '../api';

/** The failure message for a failed creation attempt (PRD share.create). */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * Backoff for the `attempt`-th consecutive failed existence check (story 5,
 * share.bad_link retry): doubles from BOARD_CHECK_RETRY_BASE_MS (1 s, 2 s,
 * 4 s, …), capped at RECONNECT_MAX_BACKOFF_MS (30 s).
 */
export function boardCheckBackoffMs(attempt: number): number {
  return Math.min(
    BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    RECONNECT_MAX_BACKOFF_MS,
  );
}

/**
 * Board page transition (story 5): an existence-check result turns the
 * page state into ready (mount the board), not_found (Board not found) or
 * unreachable (retry message; the page schedules the next check after
 * `nextRetryMs`).
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  void state;
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: boardCheckBackoffMs(attempt) };
  }
}
