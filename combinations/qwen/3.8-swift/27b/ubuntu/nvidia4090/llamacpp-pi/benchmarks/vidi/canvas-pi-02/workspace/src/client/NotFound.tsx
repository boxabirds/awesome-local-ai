// Not found (story 5, share.not_found): shown when a board link does not
// exist (after the existence check has retried) or for an unrecognised
// route. "Create a new board" reuses the home create action (POST
// /api/boards → navigate), and a link goes back home.

import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BoardCreateRateLimited, createBoard } from './api';

export function NotFound(): ReactElement {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createBoard();
      navigate(`/b/${id}`);
    } catch (e) {
      setCreating(false);
      if (e instanceof BoardCreateRateLimited) {
        setError("You're creating boards too quickly. Wait a minute and try again.");
      } else {
        setError("Couldn't create a board. Please try again.");
      }
    }
  };

  return (
    <div className="not-found">
      <h1 className="not-found-title">Board not found</h1>
      <p className="not-found-subtitle">
        The link may be wrong, or the board may have been removed.
      </p>
      <button
        className="not-found-create"
        data-testid="not-found-create"
        onClick={onCreate}
        disabled={creating}
      >
        {creating ? 'Creating…' : 'Create a new board'}
      </button>
      {error !== null && (
        <p className="not-found-error" data-testid="not-found-error" role="alert">
          {error}
        </p>
      )}
      <Link className="not-found-home" data-testid="not-found-home" to="/">
        Go home
      </Link>
    </div>
  );
}
