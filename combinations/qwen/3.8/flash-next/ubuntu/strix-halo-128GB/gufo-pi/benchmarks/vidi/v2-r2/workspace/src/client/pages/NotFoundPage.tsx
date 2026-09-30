import type { ReactElement } from 'react';
import { navigate } from '@client/router';
import { useCreateBoard } from './useCreateBoard';

/**
 * Board not found page (share.not_found). Shown for malformed and unknown board
 * links; offers a New board button (reusing the create action, creating nothing
 * here) and a link back to the home page.
 */
export function NotFoundPage(): ReactElement {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <main className="not-found-page">
      <h1 className="not-found-title">Board not found</h1>
      <p className="not-found-text">
        The board you're looking for doesn't exist or has been deleted.
      </p>
      <button
        type="button"
        className="new-board-button"
        onClick={create}
        disabled={creating}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          Back to home
        </a>
      </p>
      {state.kind === 'create_failed' && (
        <p role="alert" className="home-error">
          {state.message}
        </p>
      )}
    </main>
  );
}
