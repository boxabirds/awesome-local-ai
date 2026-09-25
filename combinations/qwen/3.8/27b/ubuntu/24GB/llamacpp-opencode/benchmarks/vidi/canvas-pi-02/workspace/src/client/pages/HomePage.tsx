/**
 * Home page (story 5, share.pages).
 *
 * Shows the product name, one-line description, and a Create a board button.
 * States: Idle → Creating → (navigate | CreateFailed | RateLimited)
 */
import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export type CreateState = 'idle' | 'creating' | 'failed' | 'rate_limited';

export function HomePage() {
  const [state, setState] = useState<CreateState>('idle');

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

  const isCreating = state === 'creating';

  return (
    <div className="vidi6-home" data-testid="home-page">
      <h1 className="vidi6-home__title">vidi6</h1>
      <p className="vidi6-home__description">A shared board for thinking together</p>
      <button
        className="vidi6-home__create"
        onClick={handleCreate}
        disabled={isCreating}
        aria-label="Create a board"
        data-testid="create-board-button"
      >
        {isCreating ? 'Creating…' : 'Create a board'}
      </button>
      {state === 'failed' && (
        <p className="vidi6-home__error" role="alert" data-testid="create-error">
          Couldn't create a board. Please try again.
        </p>
      )}
      {state === 'rate_limited' && (
        <p className="vidi6-home__error" role="alert" data-testid="rate-limit-error">
          You're creating boards too quickly. Wait a minute and try again.
        </p>
      )}
    </div>
  );
}
