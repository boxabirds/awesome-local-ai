/**
 * The one action two pages share: make a board and go to it.
 *
 * It lives here rather than in the home page because the Board not found page offers it too, and
 * there is no second kind of new board — the person who followed a dead link is offered the same
 * thing the home page offers, which is a board that is actually theirs, not a consolation prize.
 *
 * What the hook owns is the part that is easy to get wrong in a component: the button has to be busy
 * while the request is out (a second click would make a second board, and nothing would ever tell
 * anybody), the answer has to be thrown away if the person has left the page in the meantime, and a
 * failure has to leave the button ready to be pressed again rather than sorry about itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { createBoardRequest } from '../api';
import type { CreateResponse } from '../api';
import { openBoard } from '../router';
import { CREATE_FAILED_MESSAGE } from './state';
import type { HomePageState } from './state';

export interface CreateBoardAction {
  state: HomePageState;
  /** Ask for a board. Does nothing while one is already being made. */
  create: () => void;
}

export function useCreateBoard(): CreateBoardAction {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  // Whether this component is still the page it was rendered as. An answer about a board is a
  // promise about where to go, and a person who has since gone somewhere else must not be moved.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useCallback((): void => {
    setState((current) => (current.kind === 'creating' ? current : { kind: 'creating' }));
    const failed = (): void => {
      if (mounted.current) setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    };
    const settled = (response: CreateResponse): void => {
      if (!mounted.current) return;
      if (response.kind !== 'created') {
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
        return;
      }
      // The board is opened rather than offered: it was just made for a person who meant to be on
      // it, and a page that says "here is your new board, go to it" is a page with an extra click
      // and a board nobody has opened yet.
      openBoard(response.id);
    };
    // Both ways of not getting a board end in the same message. The one that throws is not a case
    // the API is supposed to produce — it answers with a state, not an exception — and a button left
    // saying "Creating…" forever is the worst possible answer to a person who wants a board.
    void Promise.resolve(createBoardRequest()).then(settled, failed);
  }, []);

  return { state, create };
}
