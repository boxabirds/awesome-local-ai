/**
 * Page state machines (story 5, share.board_page).
 *
 * nextBoardPageState is pure and unit-tested: it decides what the board page
 * shows for a check result. Terminal states (ready, not_found) are sticky —
 * the check never runs again once one is reached.
 */
import { useCallback, useRef, useState } from 'react';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { checkBoard, createBoardRequest, type CheckResponse } from '../api';
import { navigate } from '../router';

/** share.create: the fixed retry message shown when creation fails. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: string };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * Pure transition for the board page's existence check.
 * `attempt` counts checks started so far (the result being fed in is the
 * outcome of check number `attempt`); the retry delay doubles per failed
 * attempt and is capped at RECONNECT_MAX_BACKOFF_MS.
 */
export function nextBoardPageState(
  boardId: string,
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  if (state.kind === 'ready' || state.kind === 'not_found') return state; // terminal
  if (result.kind === 'exists') return { kind: 'ready', boardId };
  if (result.kind === 'not_found') return { kind: 'not_found' };
  return {
    kind: 'unreachable',
    attempt,
    nextRetryMs: Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS),
  };
}

/**
 * The create action shared by the home and board-not-found pages
 * (share.create): POST /api/boards, then navigate to the new board on
 * success. A re-click while a request is in flight is ignored.
 */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const busyRef = useRef(false);
  const create = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState({ kind: 'creating' });
    void createBoardRequest().then(
      (result) => {
        busyRef.current = false;
        if (result.kind === 'created') {
          navigate(`/b/${result.id}`);
        } else {
          setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
        }
      },
      () => {
        // createBoardRequest maps network errors to 'failed', but never let
        // a rejection crash the page (share.create).
        busyRef.current = false;
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      },
    );
  }, []);
  return { state, create };
}
