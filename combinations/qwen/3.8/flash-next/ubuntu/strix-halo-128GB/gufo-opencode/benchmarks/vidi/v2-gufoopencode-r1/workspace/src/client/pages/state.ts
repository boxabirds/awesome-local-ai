import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

export const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILURE_MESSAGE };

// `ready` carries the board id so BoardShell mounts against the right board.
// `nextBoardPageState` has no access to the id, so the caller patches it in;
// the empty placeholder makes that contract explicit.
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

// Exponential backoff: attempt 0 waits BOARD_CHECK_RETRY_BASE_MS, then each
// doubles, capped at the story 3 reconnect ceiling.
export function nextRetryMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
}

export function nextBoardPageState(state: BoardPageState, result: CheckResponse, attempt: number): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      if (state.kind === 'ready') return state;
      return { kind: 'unreachable', attempt: attempt + 1, nextRetryMs: nextRetryMs(attempt) };
  }
}
