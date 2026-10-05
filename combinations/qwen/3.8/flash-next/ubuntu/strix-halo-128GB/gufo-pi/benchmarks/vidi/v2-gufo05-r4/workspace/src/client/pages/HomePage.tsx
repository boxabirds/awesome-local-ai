/**
 * The page you land on (`share.create`).
 *
 * One action, and the whole of it is to ask for a board and take the person there. It is
 * not a list of boards, not a preview of the last one, not a board with nothing on it:
 * stories 14-15 will decide what else this page is, and until then a second affordance here
 * would be a second thing to keep true.
 *
 * `useNewBoard` is exported because the Board not found page offers the same action — a
 * person with a broken link wants a working board, which is the same request and deserves
 * the same three states and the same words (`share.not_found`, `share.create_failure`).
 */

import { useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { boardPath, navigate } from '../router';
import { CREATE_FAILURE_MESSAGE, type HomePageState } from './state';

/**
 * The New board action, in the three states the PRD names.
 *
 * A click while `creating` is ignored rather than queued: one person clicking twice
 * deserves one board, not two (`share.create`). The button is disabled for the same reason,
 * and this is the second line of that defence rather than the only one.
 */
export function useNewBoard(): { state: HomePageState; newBoard: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  async function create(): Promise<void> {
    if (state.kind === 'creating') return;
    setState({ kind: 'creating' });
    const response = await createBoardRequest();
    if (response.kind === 'created') {
      // The address is the thing that was made, so it changes first and the board follows.
      navigate(boardPath(response.id));
      return;
    }
    // Nothing has been lost and the person has not moved: the message goes under the
    // button, and the button works again (`share.create_failure`).
    setState({ kind: 'create_failed', message: CREATE_FAILURE_MESSAGE });
  }

  return { state, newBoard: () => void create() };
}

/** Where a board begins: the product's name, one sentence, and one button. */
export function HomePage(): JSX.Element {
  const { state, newBoard } = useNewBoard();
  const creating = state.kind === 'creating';

  return (
    <div className="vidi6-page vidi6-page--home">
      <header className="vidi6-page__header">
        <span className="vidi6-logo">vidi6</span>
      </header>
      <main className="vidi6-home">
        <h1 className="vidi6-home__pitch">A shared board for thinking together.</h1>
        <button
          type="button"
          className="vidi6-button vidi6-button--primary"
          onClick={newBoard}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'New board'}
        </button>
        {/* The space beneath the button is reserved whether or not there is a message, so
            a failure does not shove the button anywhere. */}
        <p className="vidi6-home__message" role="status">
          {state.kind === 'create_failed' ? state.message : ''}
        </p>
      </main>
    </div>
  );
}
