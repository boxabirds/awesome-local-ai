// Board not found page (story 5, share.not_found): shown for links to boards
// that do not exist (or whose code is malformed). Nothing is created here
// unless the person asks for a new board.

import type { JSX } from 'react';
import { useCreateBoard } from './state';

export function NotFoundPage(): JSX.Element {
  const { state, start } = useCreateBoard();
  return (
    <main className="page not-found-page" data-testid="not-found-page">
      <h1 className="page-title">Board not found</h1>
      <p className="page-subtitle">
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        type="button"
        className="new-board-button"
        onClick={start}
        disabled={state.kind === 'creating'}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p className="page-error" role="alert" data-testid="create-error">
          {state.message}
        </p>
      )}
      <a className="home-link" href="/">
        Go to home page
      </a>
    </main>
  );
}
