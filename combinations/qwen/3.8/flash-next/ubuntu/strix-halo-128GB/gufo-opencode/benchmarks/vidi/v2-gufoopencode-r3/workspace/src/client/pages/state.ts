import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

// Exact PRD copy (share.create_failure).
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

// One step of the board-page state machine (design share.pages). `attempt` is
// how many retries have already been scheduled for the current outage (0 when
// coming from 'checking'); the next backoff doubles from the base and is
// capped at RECONNECT_MAX_BACKOFF_MS.
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string
): BoardPageState {
  if (result.kind === 'exists') return { kind: 'ready', boardId };
  if (result.kind === 'not_found') return { kind: 'not_found' };
  const nextAttempt = attempt + 1;
  const nextRetryMs = Math.min(
    BOARD_CHECK_RETRY_BASE_MS * 2 ** (nextAttempt - 1),
    RECONNECT_MAX_BACKOFF_MS
  );
  return { kind: 'unreachable', attempt: nextAttempt, nextRetryMs };
}
