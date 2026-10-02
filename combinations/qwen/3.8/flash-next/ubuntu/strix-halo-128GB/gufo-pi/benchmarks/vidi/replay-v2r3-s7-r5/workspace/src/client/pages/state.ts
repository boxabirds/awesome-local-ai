import type { CheckResponse } from '../api';

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: string };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * Compute the next BoardPageState from the current state and a check result.
 * `attempt` is the number of retries so far (0-indexed: first check is attempt 0).
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' }; // boardId set by caller
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt),
        RECONNECT_MAX_BACKOFF_MS,
      );
      return { kind: 'unreachable', attempt: attempt + 1, nextRetryMs };
    }
  }
}
