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
 * Compute the next BoardPageState given the current state, check result, and attempt number.
 * attempt is the 0-based count of retries so far.
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  if (result.kind === 'exists') {
    // We need the boardId; it's provided by the caller in context
    // This function returns 'ready' without a boardId, caller fills it in
    return { kind: 'ready', boardId: '' };
  }
  if (result.kind === 'not_found') {
    return { kind: 'not_found' };
  }
  // unreachable
  const nextRetryMs = Math.min(
    BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt),
    RECONNECT_MAX_BACKOFF_MS,
  );
  return { kind: 'unreachable', attempt: attempt + 1, nextRetryMs };
}
