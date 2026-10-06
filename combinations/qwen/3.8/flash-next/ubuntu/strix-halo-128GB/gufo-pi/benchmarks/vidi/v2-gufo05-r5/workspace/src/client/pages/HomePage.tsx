/**
 * Home page: product name, one-line description, New board button.
 *
 * Clicking "New board" creates a board via the API and navigates to it.
 * If creation fails, shows an error message and re-enables the button.
 */
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage(): JSX.Element {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const handleNewBoard = useCallback(async () => {
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState({ kind: 'create_failed', message: "Couldn't create a board. Please try again." });
    }
  }, []);

  const creating = state.kind === 'creating';

  return (
    <div className="home-page">
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <button
        onClick={handleNewBoard}
        disabled={creating}
        aria-label="New board"
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" className="error-message">
          {state.message}
        </p>
      )}
    </div>
  );
}
