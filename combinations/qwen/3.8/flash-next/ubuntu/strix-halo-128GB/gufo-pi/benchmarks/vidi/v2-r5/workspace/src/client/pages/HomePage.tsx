import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

/**
 * Home page: product name, description, New board button, error message area.
 */
export function HomePage() {
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

  const disabled = state.kind === 'creating';

  return (
    <div className="home-page">
      <h1>vidi6</h1>
      <p className="home-description">A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={disabled}
        aria-label="New board"
      >
        {state.kind === 'creating' ? 'Creating\u2026' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" className="home-error">{state.message}</p>
      )}
    </div>
  );
}
