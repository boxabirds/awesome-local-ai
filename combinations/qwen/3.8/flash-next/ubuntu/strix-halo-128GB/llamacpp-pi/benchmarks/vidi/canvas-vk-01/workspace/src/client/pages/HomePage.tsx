import { useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

/**
 * Home page: product name, description, Create a board button.
 * States: Idle → Creating → (navigate) | CreateFailed | RateLimited.
 */
export function HomePage(): JSX.Element {
  const [state, setState] = useState<'idle' | 'creating'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    setState('creating');
    setError(null);

    const result = await createBoardRequest();

    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    setState('idle');
    if (result.kind === 'rate_limited') {
      setError("You're creating boards too quickly. Wait a minute and try again.");
    } else {
      setError("Couldn't create a board. Please try again.");
    }
  };

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
      {error !== null && (
        <p className="error-message" role="alert">{error}</p>
      )}
    </div>
  );
}
