/**
 * Page state machines (story 5, share.pages).
 *
 * Note: the design's `nextBoardPageState(state, result, attempt)` must be
 * able to produce `{ kind: 'ready', boardId }`, so `checking` and
 * `unreachable` carry the boardId (a small extension of the design
 * contract; see NOTES.md).
 */
import { useCallback, useRef, useState } from 'react';
import { createBoardRequest, type CheckResponse } from '../api';
import { navigate } from '../router';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/** PRD share.create_failure message (exact). */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again." as const;

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking'; boardId: string }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; boardId: string; attempt: number; nextRetryMs: number };

/**
 * Board page state transition for one existence-check result.
 * Backoff doubles from BOARD_CHECK_RETRY_BASE_MS per attempt, capped at
 * RECONNECT_MAX_BACKOFF_MS (story 3 setting).
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  // not_found is terminal (no further checks for a board that doesn't exist).
  if (state.kind === 'not_found') return state;
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: state.boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1),
        RECONNECT_MAX_BACKOFF_MS,
      );
      return { kind: 'unreachable', boardId: state.boardId, attempt, nextRetryMs };
    }
  }
}

/**
 * Shared "New board" create action, used by the Home page and the Board
 * not found page. idle → creating → navigate on success / create_failed on
 * failure (the button becomes available again; no navigation).
 */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const create = useCallback(() => {
    if (stateRef.current.kind === 'creating') return;
    setState({ kind: 'creating' });
    void (async () => {
      const result = await createBoardRequest();
      if (result.kind === 'created') {
        navigate(`/b/${result.id}`);
      } else {
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      }
    })();
  }, []);

  return { state, create };
}
