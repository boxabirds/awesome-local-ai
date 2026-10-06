/**
 * Making a board, as a hook (design "Home, board and not-found pages").
 *
 * Two pages offer **New board** — the home page, and the Board not found page, because
 * a person holding a link that goes nowhere is exactly a person who may want a board of
 * their own — and both of them must behave identically: disabled while the creation is
 * on its way, an honest message when it fails, and *only ever one creation in flight*.
 * That last part is the reason this is one hook rather than two copies: a person who
 * clicks a button four times is entitled to one board, not four.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoardsApi, CreateResponse } from '../api.js';
import { boardsApi as realBoardsApi } from '../api.js';
import { boardPath, navigate } from '../router.js';
import { nextHomePageState, type HomePageState } from './state.js';

/** The create action: what a button does, and what a page renders from. */
export interface CreateBoardAction {
  state: HomePageState;
  /** The button's click handler. Ignores a press while a creation is in flight. */
  create(): void;
}

/**
 * Create a board and open it.
 *
 * On success this navigates, so the page that asked for the board is a different page by
 * the time the answer is worth acting on — which is why there is no `created` state to
 * render, and why the only state that can still land after the answer is a failure
 * message on a page that is still there.
 *
 * `api.create()` never rejects (that is `api.ts`'s job), but a page can be handed any
 * API, and an API that throws is handled here the same way as an API that answers
 * `failed`. A promise with no rejection handler is how a creation failure becomes an
 * unhandled rejection in the console and no message on the screen.
 */
export function useCreateBoard(api: BoardsApi = realBoardsApi): CreateBoardAction {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  // Whether this page is still on screen. React 19 does not warn about setting state
  // after unmount and does not need to: what is needed is the decision, which is that a
  // page with no place left to show a message gets no message.
  const mounted = useRef(true);
  // The creation in flight, so a second press cannot start a second board.
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useCallback((result: CreateResponse): void => {
    // Through the transition table, and through the state this page is actually in: an
    // answer that arrives after the page stopped being "creating" is an answer to a
    // press nobody is waiting on any more, and it changes nothing.
    if (mounted.current) setState((current) => nextHomePageState(current, result));
  }, []);

  const create = useCallback((): void => {
    if (pending.current) return;
    pending.current = true;
    setState({ kind: 'creating' });

    // Whatever the answer is, the press is over: the flag that stops a second click from
    // making a second board has to be let go, or "the button is available again" is a line
    // in a document and a lie on the screen.
    const done = (): void => {
      pending.current = false;
    };

    api
      .create()
      .then((result) => {
        if (result.kind === 'created') {
          // The board exists. The address is what the person came for, so the address
          // bar goes there and the page follows it — `pushState`, so Back returns to
          // the home page rather than out of the app. The state goes back to `idle`
          // rather than anywhere else because this page is about to be unmounted by that
          // navigation, and if it is not (the same path, a test, a blocked navigation)
          // an idle home page is the honest thing to leave showing.
          navigate(boardPath(result.id));
          if (mounted.current) setState({ kind: 'idle' });
          done();
          return;
        }
        settle(result);
      }, () => settle({ kind: 'failed' }))
      .catch(() => settle({ kind: 'failed' }))
      .finally(done);
  }, [api, settle]);

  return { state, create };
}
