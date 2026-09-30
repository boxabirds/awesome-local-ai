import type { ReactElement } from 'react';
import { useCreateBoard } from './useCreateBoard';

/**
 * Home page (share.create). Product name, one-line description, a prominent New
 * board button, and an error slot beneath the button (share.create_failure).
 */
export function HomePage(): ReactElement {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <main className="home-page">
      <h1 className="home-title">vidi6</h1>
      <p className="home-tagline">A shared board for thinking together</p>
      <button
        type="button"
        className="new-board-button"
        onClick={create}
        disabled={creating}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" className="home-error">
          {state.message}
        </p>
      )}
    </main>
  );
}
