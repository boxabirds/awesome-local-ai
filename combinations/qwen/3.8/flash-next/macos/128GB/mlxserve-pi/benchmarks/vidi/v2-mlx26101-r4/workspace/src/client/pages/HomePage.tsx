/**
 * The page a person starts on.
 *
 * There is one thing to do here, so there is one button. It is tempting to put a board on the home
 * page — a recent board, a sample, something to look at — and this product has no way to know what
 * is recent or whose it is, because a board is only ever reached by its link. So the page says what
 * the thing is, in the words the product uses, and offers the one action that a person arriving here
 * without a link can mean: start a board and send it to somebody.
 *
 * Clicking the button either goes somewhere or says it did not. The middle case is the one that
 * needs the wording: when a board could not be made, the person stays exactly where they were with a
 * sentence that says what happened, because "nothing was created" is the reassuring part of a failure
 * like this — no half-board is waiting somewhere with their name on it.
 */
import type { JSX } from 'react';

import { useCreateBoard } from './useCreateBoard';

export function HomePage(): JSX.Element {
  const { state, create } = useCreateBoard();

  return (
    <main className="page" data-testid="home-page">
      <div className="page__card">
        <h1 className="page__title">vidi6</h1>
        <p className="page__tagline">A shared board for thinking together</p>

        <button
          type="button"
          className="page__action"
          data-testid="new-board"
          onClick={() => {
            create();
          }}
          // Disabled while the board is being made, so that a second click cannot make a second
          // board that nobody asked for and nobody has the link to.
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
      </div>
    </main>
  );
}
