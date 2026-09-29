import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

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

/** Wait before retry number `attempt` (1-based): doubles from BOARD_CHECK_RETRY_BASE_MS, capped. */
export function retryDelayMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The board page after check number `attempt` (1-based) answered `result`. `ready` and
 * `not_found` are final. `boardId` (the page's id) is what a `ready` state opens.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId = state.kind === 'ready' ? state.boardId : '',
): BoardPageState {
  if (state.kind === 'ready' || state.kind === 'not_found') return state;
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: retryDelayMs(attempt) };
  }
}
