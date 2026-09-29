import { useCallback, useState } from 'react';
import type { CheckResponse } from '../api';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';

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
 * Pure state transition for the board page (share.pages):
 * exists → ready, not_found → not_found, unreachable → unreachable with an
 * exponential backoff (BOARD_CHECK_RETRY_BASE_MS doubled per attempt, capped
 * at RECONNECT_MAX_BACKOFF_MS).
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  if (result.kind === 'exists') {
    // The pure transition cannot know the id (it is not in `checking`), so it
    // returns an empty boardId when the current state carries none. The page,
    // which owns the id, injects it (see BoardPage).
    const boardId = state.kind === 'ready' ? state.boardId : '';
    return { kind: 'ready', boardId };
  }
  if (result.kind === 'not_found') {
    return { kind: 'not_found' };
  }
  const nextRetryMs = Math.min(
    BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1),
    RECONNECT_MAX_BACKOFF_MS,
  );
  return { kind: 'unreachable', attempt, nextRetryMs };
}

/**
 * The "New board" create action, shared by HomePage and NotFoundPage
 * (share.create, share.create_failure). On success the page navigates to the
 * new board; on failure it stays put and shows the failure message.
 */
export function useCreateBoard(): {
  state: HomePageState;
  startCreate: () => void;
} {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const startCreate = useCallback(() => {
    setState({ kind: 'creating' });
    createBoardRequest().then((result) => {
      if (result.kind === 'created') {
        navigate(`/b/${result.id}`);
      } else {
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      }
    });
  }, []);

  return { state, startCreate };
}
