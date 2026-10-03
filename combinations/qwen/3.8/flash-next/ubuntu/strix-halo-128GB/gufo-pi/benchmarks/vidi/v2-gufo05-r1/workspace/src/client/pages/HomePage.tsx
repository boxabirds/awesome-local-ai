/**
 * The home page: one promise and one button.
 *
 * "A shared board for thinking together", and a button that makes one. Pressing it asks
 * the Worker for a board and goes to it; there is no other way for a board to exist in
 * this app, which is what makes a board's address mean something.
 *
 * The waiting state is the part that is easy to get wrong. The press is a request to a
 * server, so it can be slow and it can fail: the button says "Creating…", refuses a
 * second press while the first is still in the air (two boards from one press is worse
 * than none, and the disabled button is how the person knows), and a failure is stated in
 * the same place rather than in silence.
 */
import { useCallback, useRef, useState, type JSX } from 'react';

import * as api from '../api';
import { boardPath, navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/** The create action, shared by the home page and the not-found page. */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  // In flight lives in a ref, not in `state`, because the guard has to hold inside the
  // handler: two clicks in the same frame both see `idle` if the only record is state.
  const inFlight = useRef(false);

  const create = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'creating' });
    void api.createBoardRequest().then((result) => {
      inFlight.current = false;
      if (result.kind === 'created') {
        // Straight to the board, whose address now works because this call made it one.
        navigate(boardPath(result.id));
        return;
      }
      setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    });
  }, []);

  return { state, create };
}

export function HomePage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <main className="page">
      <div className="page__card">
        <h1 className="page__title">vidi6</h1>
        <p className="page__tagline">A shared board for thinking together</p>
        <button
          type="button"
          className="page__button page__button--primary"
          onClick={create}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'New board'}
        </button>
        {state.kind === 'create_failed' ? (
          <p className="page__error" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
