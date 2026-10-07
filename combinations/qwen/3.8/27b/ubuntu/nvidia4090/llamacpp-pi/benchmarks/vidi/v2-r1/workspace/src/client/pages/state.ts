// Page state machines (story 5, share.pages): the pure transitions plus the
// shared "New board" action used by the Home page and the Board not found
// page.

import { useCallback, useRef, useState } from 'react';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import type { CheckResponse } from '../api';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** Retry backoff for the given failed attempt (1-based): the base doubles per
 *  attempt, capped at RECONNECT_MAX_BACKOFF_MS (story 3). */
export function boardCheckRetryMs(attempt: number): number {
  const attemptClamped = Math.max(1, attempt);
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attemptClamped - 1), RECONNECT_MAX_BACKOFF_MS);
}

/**
 * Pure transition for BoardPage existence checks. `exists` yields `ready`
 * (BoardPage fills in the board id it is mounted with); `not_found` is
 * terminal; `unreachable` records the attempt and its backoff.
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
      return { kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryMs(attempt) };
  }
}

/**
 * The shared "New board" create action (Home page and Board not found):
 * guards double clicks, navigates to the new board on success (creating
 * nothing when it fails), and surfaces the failure message.
 */
export function useCreateBoard(): { state: HomePageState; start: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const busy = useRef(false);

  const start = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'creating' });
    void createBoardRequest().then((res) => {
      busy.current = false;
      if (res.kind === 'created') {
        setState({ kind: 'idle' });
        navigate(`/b/${res.id}`);
      } else {
        setState({ kind: 'create_failed', message: CREATE_FAILURE_MESSAGE });
      }
    });
  }, []);

  return { state, start };
}
