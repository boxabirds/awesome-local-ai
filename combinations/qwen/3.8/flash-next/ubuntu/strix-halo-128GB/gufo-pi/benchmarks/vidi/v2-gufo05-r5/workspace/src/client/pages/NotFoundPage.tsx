/**
 * Board not found page: heading, guidance text, New board button, link home.
 */
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function NotFoundPage(): JSX.Element {
  const [createState, setCreateState] = useState<HomePageState>({ kind: 'idle' });

  const handleNewBoard = useCallback(async () => {
    setCreateState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setCreateState({ kind: 'create_failed', message: "Couldn't create a board. Please try again." });
    }
  }, []);

  const creating = createState.kind === 'creating';

  return (
    <div className="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleNewBoard}
        disabled={creating}
        aria-label="New board"
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {createState.kind === 'create_failed' && (
        <p role="alert" className="error-message">
          {createState.message}
        </p>
      )}
      <p>
        <a href="/">Back to home</a>
      </p>
    </div>
  );
}
