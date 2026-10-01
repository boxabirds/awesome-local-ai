import type { CheckResponse } from '../api';

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
 * Compute the next BoardPageState given the current state, check result, and attempt number.
 * Backoff: BOARD_CHECK_RETRY_BASE_MS * 2^(attempt-1), capped externally.
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' }; // boardId filled by caller
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: 0 }; // nextRetryMs filled by caller
  }
}
