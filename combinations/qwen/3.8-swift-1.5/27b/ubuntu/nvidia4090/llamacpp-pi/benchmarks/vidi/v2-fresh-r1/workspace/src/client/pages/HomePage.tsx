// Home page: product name, description, New board button.

import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage() {
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
    <div className="home-page" data-testid="home-page">
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={isCreating}
        data-testid="new-board-button"
      >
        {isCreating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p className="home-page__error" data-testid="home-error">
          {state.message}
        </p>
      )}
    </div>
  );
}
