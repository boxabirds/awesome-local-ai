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

/**
 * Pure transition for the BoardPage existence check (story 5).
 *
 * `attempt` is the 1-based number of the check that just completed. On
 * 'unreachable' the retry backoff doubles from BOARD_CHECK_RETRY_BASE_MS,
 * capped at RECONNECT_MAX_BACKOFF_MS (story 3).
 *
 * (The design contract is `nextBoardPageState(state, result, attempt)`; the
 * `boardId` parameter is added because the 'ready' state must carry the id
 * and the contract's inputs do not. See NOTES.md.)
 */
export function nextBoardPageState(
  boardId: string,
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return {
        kind: 'unreachable',
        attempt,
        nextRetryMs: Math.min(
          BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1),
          RECONNECT_MAX_BACKOFF_MS
        ),
      };
  }
}
