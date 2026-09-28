/**
 * Home page: product name, one-line description, Create a board button.
 */
import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

type HomeState = 'idle' | 'creating';

export function HomePage() {
  const [state, setHomeState] = useState<HomeState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    setHomeState('creating');
    setError(null);

    const result = await createBoardRequest();

    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }

    setHomeState('idle');

    if (result.kind === 'rate_limited') {
      setError("You're creating boards too quickly. Wait a minute and try again.");
    } else {
      setError("Couldn't create a board. Please try again.");
    }
  }, []);

  return (
    <div className="home-page">
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={state === 'creating'}
        aria-label="Create a board"
      >
        {state === 'creating' ? 'Creating…' : 'Create a board'}
      </button>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  );
}
