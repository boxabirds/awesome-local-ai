import { useCallback, useRef, useState } from 'react';
import { createBoardRequest, type CheckResponse } from '../api';
import { navigate } from '../router';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

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

/**
 * Exponential backoff for board existence checks:
 * BOARD_CHECK_RETRY_BASE_MS × 2^(attempt−1), capped at RECONNECT_MAX_BACKOFF_MS.
 */
export function boardCheckBackoffMs(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS);
}

/**
 * Pure state transition for the board page check loop (share.open_link /
 * share.not_found / share.unreachable). The `ready` boardId is filled in by
 * the page, which owns the id from the route.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return state.kind === 'ready' ? state : { kind: 'ready', boardId: '' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt, nextRetryMs: boardCheckBackoffMs(attempt) };
  }
}

/**
 * The shared "New board" action (Home page and Board not found page):
 * idle → creating → navigate to the new board on success, create_failed on
 * failure (stays on the current page, button available again).
 */
export function useCreateBoard(): { state: HomePageState; start: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const creatingRef = useRef(false);

  const start = useCallback(() => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setState({ kind: 'creating' });
    createBoardRequest()
      .then((res) => {
        creatingRef.current = false;
        if (res.kind === 'created') {
          navigate(`/b/${res.id}`);
        } else {
          setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
        }
      })
      .catch(() => {
        creatingRef.current = false;
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      });
  }, []);

  return { state, start };
}
