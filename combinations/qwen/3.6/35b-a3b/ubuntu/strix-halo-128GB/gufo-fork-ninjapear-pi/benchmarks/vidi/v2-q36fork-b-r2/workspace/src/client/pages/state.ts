import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

// ---------------------------------------------------------------------------
// HomePageState
// ---------------------------------------------------------------------------

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

// ---------------------------------------------------------------------------
// BoardPageState
// ---------------------------------------------------------------------------

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * State machine for the board page existence check with retry when unreachable.
 * Returns not_found or an updated unreachable state with backoff.
 * Does NOT return ready — that's handled by the caller.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'not_found':
      return { kind: 'not_found' };

    case 'unreachable': {
      const baseDelay = BOARD_CHECK_RETRY_BASE_MS;
      const maxBackoff = RECONNECT_MAX_BACKOFF_MS;
      const delay = Math.min(baseDelay * (1 << attempt), maxBackoff);
      return {
        kind: 'unreachable',
        attempt: attempt + 1,
        nextRetryMs: delay,
      };
    }

    // 'exists' is never passed here — callers handle it before calling this
    case 'exists':
      return state; // identity transform, shouldn't happen
  }
}

/** Helper type guard for board pages */
export function isBoardPageState(state: BoardPageState): state is { kind: 'ready'; boardId: string } {
  return state.kind === 'ready';
}
