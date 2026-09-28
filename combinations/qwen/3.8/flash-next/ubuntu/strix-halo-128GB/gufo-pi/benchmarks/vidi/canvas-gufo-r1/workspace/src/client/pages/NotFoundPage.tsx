import { useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export function NotFoundPage() {
  const [state, setState] = useState<'idle' | 'creating' | 'failed' | 'rate_limited'>('idle');

  const handleCreate = async () => {
    setState('creating');
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else if (result.kind === 'rate_limited') {
      setState('rate_limited');
    } else {
      setState('failed');
    }
  };

  return (
    <div className="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <button
        data-testid="not-found-create-btn"
        onClick={handleCreate}
        disabled={state === 'creating'}
      >
        {state === 'creating' ? 'Creating…' : 'Create a new board'}
      </button>
      <div>
        <a href="/" data-testid="home-link">Go to home page</a>
      </div>
      {state === 'failed' && (
        <p data-testid="create-error">Couldn't create a board. Please try again.</p>
      )}
      {state === 'rate_limited' && (
        <p data-testid="rate-limit-error">You're creating boards too quickly. Wait a minute and try again.</p>
      )}
    </div>
  );
}
