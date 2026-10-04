/**
 * Home page: product name, description, New board button.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage(): JSX.Element {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const busyRef = useRef(false);

  const handleCreate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState({ kind: 'creating' });

    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      // State will be reset by navigation (component unmounts)
    } else {
      setState({ kind: 'create_failed', message: "Couldn't create a board. Please try again." });
    }
    busyRef.current = false;
  }, []);

  const isCreating = state.kind === 'creating';
  const errorMessage = state.kind === 'create_failed' ? state.message : null;

  return (
    <div className="home-page" data-vidi6="home-page">
      <h1 data-vidi6="home-title">vidi6</h1>
      <p data-vidi6="home-description">A shared board for thinking together</p>
      <button
        data-vidi6="new-board-button"
        onClick={handleCreate}
        disabled={isCreating}
      >
        {isCreating ? 'Creating…' : 'New board'}
      </button>
      {errorMessage && (
        <p data-vidi6="home-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
