import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * Story 5: page state machines (share.home, share.open_link, share.copy).
 */

export const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: string };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * Backoff for existence-check retries: doubles from BOARD_CHECK_RETRY_BASE_MS
 * (1 s) up to RECONNECT_MAX_BACKOFF_MS (15 s). attempt is 1-based.
 */
export function boardCheckRetryMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** exponent, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * Pure transition function for BoardPage state (share.open_link):
 *   exists     → ready (the caller fills in the board id)
 *   not_found  → not_found (terminal)
 *   unreachable → unreachable with the next backoff delay
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  if (result.kind === 'exists') {
    return { kind: 'ready', boardId: state.kind === 'ready' ? state.boardId : '' };
  }
  if (result.kind === 'not_found') {
    return { kind: 'not_found' };
  }
  return { kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryMs(attempt) };
}
