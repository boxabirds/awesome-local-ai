import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

/**
 * Home page: product name, one-line description, New board button.
 */
export function HomePage(): React.JSX.Element {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const handleCreate = useCallback(async () => {
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState({ kind: 'create_failed', message: "Couldn't create a board. Please try again." });
    }
  }, []);

  const isCreating = state.kind === 'creating';

  return (
    <div className="home-page">
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={isCreating}
        aria-label="New board"
      >
        {isCreating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert">{state.message}</p>
      )}
    </div>
  );
}
