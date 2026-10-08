/**
 * Pure state machines for the story 5 pages (design contract; unit-testable
 * without React).
 */

import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import type { CheckResponse } from '../api';

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: string };

/**
 * Board page states (share.not_found / share.unreachable). `ready` means the
 * board exists and the page renders it; the board id itself comes from the
 * route, so the state does not repeat it.
 */
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * Backoff for the board-existence check (share.unreachable): doubles from
 * BOARD_CHECK_RETRY_BASE_MS per attempt (1s, 2s, 4s, …), capped at
 * RECONNECT_MAX_BACKOFF_MS (story 3).
 */
export function boardCheckRetryMs(attempt: number): number {
  const factor = 2 ** Math.max(0, attempt - 1);
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * factor, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * Next BoardPageState after an existence-check result.
 *
 * @param state  previous state
 * @param result the check outcome
 * @param attempt 1-based attempt number (drives the backoff)
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  void state;
  if (result.kind === 'exists') {
    return { kind: 'ready' };
  }
  if (result.kind === 'not_found') {
    return { kind: 'not_found' };
  }
  return { kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryMs(attempt) };
}
