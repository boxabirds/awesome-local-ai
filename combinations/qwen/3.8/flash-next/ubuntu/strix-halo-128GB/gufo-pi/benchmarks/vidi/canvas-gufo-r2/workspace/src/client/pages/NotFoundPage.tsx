/**
 * Board not found page: heading, guidance text, Create a new board button, link home.
 */
import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

type NotFoundState = 'idle' | 'creating';

export function NotFoundPage() {
  const [state, setState] = useState<NotFoundState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
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
  }, []);

  return (
    <div className="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleCreate}
        disabled={state === 'creating'}
        aria-label="Create a new board"
      >
        {state === 'creating' ? 'Creating…' : 'Create a new board'}
      </button>
      <p>
        <a href="/">Back to home</a>
      </p>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  );
}
