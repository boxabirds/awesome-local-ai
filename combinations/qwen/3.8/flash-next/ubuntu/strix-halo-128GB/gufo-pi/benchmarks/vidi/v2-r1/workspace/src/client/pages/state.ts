/**
 * Page state types for Home and Board pages.
 */
import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * Compute the next BoardPageState given a check result, the board id, and the attempt number.
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  boardId: string,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      const nextAttempt = attempt + 1;
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt),
        RECONNECT_MAX_BACKOFF_MS,
      );
      return { kind: 'unreachable', attempt: nextAttempt, nextRetryMs };
    }
  }
}
