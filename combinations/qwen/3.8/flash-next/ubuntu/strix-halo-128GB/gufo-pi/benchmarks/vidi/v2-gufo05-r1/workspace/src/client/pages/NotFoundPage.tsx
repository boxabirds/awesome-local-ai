/**
 * The page for an address that is not a board.
 *
 * One sentence, two ways out. It has to be readable by somebody who arrived from a link
 * in a chat, ten minutes after the board they expected was deleted, on a phone: so it
 * names the thing that is missing ("Board not found"), says what they can do (check the
 * link, or ask for it again), and offers a board now.
 *
 * It never says *why*. "Deleted", "expired" and "you were never given this link" are
 * different stories to a person, but from outside a board they are the same observation,
 * and inventing one would be a guess about somebody else's board.
 */
import type { JSX } from 'react';

import { navigate } from '../router';
import { useCreateBoard } from './HomePage';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <main className="page">
      <div className="page__card">
        <h1 className="page__title">Board not found</h1>
        <p className="page__tagline">Check the link, or ask the person who shared it to send it again.</p>
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
        <a
          className="page__link"
          href="/"
          onClick={(event) => {
            // A real link, so it can be opened in a new tab or copied, followed in the
            // page when clicked.
            event.preventDefault();
            navigate('/');
          }}
        >
          Go to the home page
        </a>
      </div>
    </main>
  );
}
