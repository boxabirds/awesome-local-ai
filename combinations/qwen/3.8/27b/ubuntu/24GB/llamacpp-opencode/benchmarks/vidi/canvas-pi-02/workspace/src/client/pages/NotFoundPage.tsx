/**
 * Board not found page (story 5, share.pages).
 *
 * Shown when a board link points to a board that doesn't exist or the id
 * is malformed. Offers to create a new board and links back to home.
 */
import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export function NotFoundPage() {
  const [state, setState] = useState<'idle' | 'creating' | 'failed' | 'rate_limited'>('idle');

  const handleCreate = useCallback(async () => {
    if (state === 'creating') return;
    setState('creating');
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    setState(result.kind === 'rate_limited' ? 'rate_limited' : 'failed');
  }, [state]);

  return (
    <div className="vidi6-notfound" data-testid="not-found-page">
      <h1 className="vidi6-notfound__heading">Board not found</h1>
      <p className="vidi6-notfound__text">
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        className="vidi6-notfound__create"
        onClick={handleCreate}
        disabled={state === 'creating'}
        aria-label="Create a new board"
        data-testid="create-new-board-button"
      >
        {state === 'creating' ? 'Creating…' : 'Create a new board'}
      </button>
      {state === 'failed' && (
        <p className="vidi6-notfound__error" role="alert" data-testid="notfound-create-error">
          Couldn't create a board. Please try again.
        </p>
      )}
      {state === 'rate_limited' && (
        <p className="vidi6-notfound__error" role="alert" data-testid="notfound-rate-limit">
          You're creating boards too quickly. Wait a minute and try again.
        </p>
      )}
      <a className="vidi6-notfound__home-link" href="/" data-testid="home-link">
        Go to home
      </a>
    </div>
  );
}
