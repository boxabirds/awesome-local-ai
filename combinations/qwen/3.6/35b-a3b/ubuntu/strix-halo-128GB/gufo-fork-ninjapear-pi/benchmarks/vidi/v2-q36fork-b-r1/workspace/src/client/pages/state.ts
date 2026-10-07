/**
 * Page state machines.
 * Story 5 — share a board with others using a link.
 */
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@/shared/config';
import type { CheckResponse } from '../api';

// ── Home Page State ────────────────────────────────────────────────

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

// ── Board Page State ───────────────────────────────────────────────

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * Transition BoardPage state based on API check result.
 * Implements the state diagram: checking → ready / not_found / unreachable → backoff timer → retry.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: state.kind === 'ready' ? state.boardId : '' };

    case 'not_found':
      return { kind: 'not_found' };

    case 'unreachable': {
      const nextBackoff = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt),
        RECONNECT_MAX_BACKOFF_MS,
      );
      return {
        kind: 'unreachable',
        attempt: attempt + 1,
        nextRetryMs: nextBackoff,
      };
    }
  }
}
