/**
 * Page state types and transition logic for Home and Board pages.
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
 * Compute the next BoardPageState given the current state, a check result,
 * and the current attempt number.
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' }; // boardId filled in by caller
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      // Exponential backoff: base * 2^(attempt-1), capped at RECONNECT_MAX_BACKOFF_MS
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt - 1),
        RECONNECT_MAX_BACKOFF_MS,
      );
      return { kind: 'unreachable', attempt, nextRetryMs };
    }
  }
}
