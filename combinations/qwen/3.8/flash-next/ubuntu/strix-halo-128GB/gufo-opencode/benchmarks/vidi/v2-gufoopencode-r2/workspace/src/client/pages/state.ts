// Story 5: the Home and Board page state machines (pure transitions, so
// component tests can pin every arrow in the design diagrams).

import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying\u2026";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

// `boardId` parameterises the `ready` transition: the CheckResponse contract
// carries no payload (see NOTES.md for this deviation from the design's
// three-argument sketch). `attempt` is the number of checks that have
// already failed before this result; retries back off exponentially from
// BOARD_CHECK_RETRY_BASE_MS, capped at RECONNECT_MAX_BACKOFF_MS.
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  if (state.kind === 'ready' || state.kind === 'not_found') return state;
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return {
        kind: 'unreachable',
        attempt: attempt + 1,
        nextRetryMs: Math.min(
          BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_BACKOFF_MS,
        ),
      };
  }
}
