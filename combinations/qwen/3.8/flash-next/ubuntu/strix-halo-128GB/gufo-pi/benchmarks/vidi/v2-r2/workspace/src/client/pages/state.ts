import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';
import type { CheckResponse } from '@client/api';

// Exact PRD copy for the create-failure message (share.create_failure).
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

/**
 * Transition the board page after a `checkBoard` result. `attempt` is the 1-based
 * number of the check that just failed; the next retry interval doubles from
 * BOARD_CHECK_RETRY_BASE_MS and is capped at RECONNECT_MAX_BACKOFF_MS
 * (share.unreachable). `boardId` is echoed into the `ready` state so the page can
 * mount the stories 1–4 board with the id it was given.
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  if (result.kind === 'exists') return { kind: 'ready', boardId };
  if (result.kind === 'not_found') return { kind: 'not_found' };
  const nextRetryMs = Math.min(
    BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1)),
    RECONNECT_MAX_BACKOFF_MS,
  );
  return { kind: 'unreachable', attempt, nextRetryMs };
}
