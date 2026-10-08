/** Page state machines — stories 1–5 */

import { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';

// ─── Home page state ──────────────────────────────────────────────

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

// ─── Board page state ─────────────────────────────────────────────

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * State transition for BoardPage based on API check result.
 * Implements the state diagram: checking → ready/not_found/unreachable → retry/backoff.
 * @param state - current state (always 'checking' when called normally)
 * @param result - response from checkBoard()
 * @returns new state
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' };

    case 'not_found':
      return { kind: 'not_found' };

    case 'unreachable': {
      const currentAttempt = state.kind === 'unreachable' ? state.attempt + 1 : 1;
      // Exponential backoff: base * 2^(attempt-1), capped at MAX
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, currentAttempt - 1),
        RECONNECT_MAX_BACKOFF_MS,
      );
      return { kind: 'unreachable', attempt: currentAttempt, nextRetryMs: delay };
    }
  }
}
