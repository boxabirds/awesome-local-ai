/**
 * The one thing the home page does: make a board, and open it (share.create).
 *
 * One click, one request, and the address changes to the new board's link. It is a
 * hook rather than page-local code because two pages ask for a board — the home page
 * and "Board not found" — and both have to say the same words in the same way when
 * the server cannot make one (share.create_failure).
 *
 * There is no queue and no retry here: a second click while a board is being made
 * would make a second board, and a person who is told to try again is being given
 * the choice, not a background attempt they cannot see.
 */

import { useCallback, useRef, useState } from 'react';

import { createBoardRequest } from '../api';
import { boardPath, navigate } from '../router';
import { nextHomeState, type HomeState } from './state';

export interface CreateBoardAction {
  state: HomeState;
  /** Ask the server for a board. Ignored while an answer is outstanding. */
  create: () => void;
}

export function useCreateBoard(): CreateBoardAction {
  const [state, setState] = useState<HomeState>({ kind: 'idle' });
  // A ref rather than the state, so a click in the same tick as another is refused
  // before React has rendered the "Creating…" that would explain it.
  const outstanding = useRef(false);

  const create = useCallback(() => {
    if (outstanding.current) return;
    outstanding.current = true;
    setState((current) => nextHomeState(current, { type: 'clicked' }));
    void createBoardRequest().then((response) => {
      outstanding.current = false;
      if (response.kind === 'created') {
        setState(nextHomeState({ kind: 'creating' }, { type: 'created' }));
        // The new board's address, not a reload of this one: Back returns here.
        navigate(boardPath(response.id));
      } else {
        setState(nextHomeState({ kind: 'creating' }, { type: 'failed' }));
      }
    });
  }, []);

  return { state, create };
}
