/**
 * The page that says there is nothing here.
 *
 * This page exists because of one specific harm. A person who follows a link with one character
 * missing should not land on an empty board: an empty board looks like a board whose contents were
 * deleted, and the person who believes that either starts typing into the wrong board or tells their
 * colleagues that the work is gone. So an address that leads nowhere says so, in as few words as it
 * can manage, and does not create anything at the address it was asked about — a board made at a
 * mistyped link would be a board in the way, owned by nobody, at the exact address somebody will
 * type correctly the next time.
 *
 * What it offers instead is the home page's one action. The person in front of a dead link usually
 * wants a board, and this is the cheapest way to get them one without their having to start again.
 */
import type { JSX } from 'react';

import { navigate } from '../router';
import { useCreateBoard } from './useCreateBoard';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();

  return (
    <main className="page" data-testid="not-found-page">
      <div className="page__card">
        <h1 className="page__title">Board not found</h1>
        <p className="page__tagline">Check the link, or ask the person who shared it to send it again.</p>

        <button
          type="button"
          className="page__action"
          data-testid="new-board"
          onClick={() => {
            create();
          }}
          disabled={state.kind === 'creating'}
          aria-busy={state.kind === 'creating'}
        >
          {state.kind === 'creating' ? 'Creating…' : 'New board'}
        </button>

        {state.kind === 'create_failed' ? (
          <p className="page__error" data-testid="create-error" role="status">
            {state.message}
          </p>
        ) : null}

        <a
          className="page__link"
          data-testid="home-link"
          href="/"
          onClick={(event) => {
            // The link is a real link, so it works with the app broken; and it is intercepted, so
            // that going home is a change of address and not a reload of the whole app.
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
