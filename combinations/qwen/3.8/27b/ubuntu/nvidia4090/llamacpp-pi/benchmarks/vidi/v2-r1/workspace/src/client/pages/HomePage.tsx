// Home page (story 5, share.create): the product name, one line, and the New
// board action. Creation failures are explained beneath the button.

import type { JSX } from 'react';
import { useCreateBoard } from './state';

export function HomePage(): JSX.Element {
  const { state, start } = useCreateBoard();
  return (
    <main className="page home-page" data-testid="home-page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-subtitle">A shared board for thinking together</p>
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
    </main>
  );
}
