import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again." as const;

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** Backoff before the retry that follows the (0-based) failed check `attempt`: doubles, capped. */
export function retryDelayMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
}

/** The state after check number `attempt` (0-based) of `state`'s board answered `result`. */
export function nextBoardPageState(state: BoardPageState, result: CheckResponse, attempt: number): BoardPageState {
  if (result.kind === 'not_found') return { kind: 'not_found' };
  if (result.kind === 'exists') {
    const boardId = 'boardId' in state ? state.boardId : '';
    return { kind: 'ready', boardId };
  }
  return { kind: 'unreachable', attempt, nextRetryMs: retryDelayMs(attempt) };
}
