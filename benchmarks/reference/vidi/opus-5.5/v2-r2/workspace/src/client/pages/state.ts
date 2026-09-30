// Page state machines (share.pages); see the story 5 design's state diagrams.
import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

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

/** Delay before retry number `attempt` (1-based): base, 2× base, 4× base … capped. */
export function boardCheckRetryDelay(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The page state after check number `attempt` (1-based) answered `result`.
 * `boardId` is the board being checked (carried into `ready`).
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId = state.kind === 'ready' ? state.boardId : '',
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryDelay(attempt) };
  }
}
