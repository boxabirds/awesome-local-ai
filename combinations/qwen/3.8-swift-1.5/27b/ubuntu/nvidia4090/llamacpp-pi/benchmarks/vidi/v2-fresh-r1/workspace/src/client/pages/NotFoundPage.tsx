// Board not found page.

import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function NotFoundPage() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const handleCreate = useCallback(async () => {
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState({
        kind: 'create_failed',
        message: "Couldn't create a board. Please try again.",
      });
    }
  }, []);

  const isCreating = state.kind === 'creating';

  return (
    <div className="not-found-page" data-testid="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleCreate}
        disabled={isCreating}
        data-testid="new-board-button"
      >
        {isCreating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p className="not-found-page__error" data-testid="home-error">
          {state.message}
        </p>
      )}
      <a href="/" data-testid="home-link">
        Back to home
      </a>
    </div>
  );
}
