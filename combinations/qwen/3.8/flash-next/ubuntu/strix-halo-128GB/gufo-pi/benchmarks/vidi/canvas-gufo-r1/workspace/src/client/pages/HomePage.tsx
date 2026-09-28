import { useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export function HomePage() {
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
    <div className="home-page">
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <button
        data-testid="create-board-btn"
        onClick={handleCreate}
        disabled={state === 'creating'}
      >
        {state === 'creating' ? 'Creating…' : 'Create a board'}
      </button>
      {state === 'failed' && (
        <p data-testid="create-error">Couldn't create a board. Please try again.</p>
      )}
      {state === 'rate_limited' && (
        <p data-testid="rate-limit-error">You're creating boards too quickly. Wait a minute and try again.</p>
      )}
    </div>
  );
}
