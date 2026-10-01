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

export function retryDelayMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS);
}

/** `attempt` is the 1-based number of the check that produced `result`. */
export function nextBoardPageState(state: BoardPageState, result: CheckResponse, attempt: number, boardId = ''): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: state.kind === 'ready' ? state.boardId : boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: retryDelayMs(attempt) };
  }
}
