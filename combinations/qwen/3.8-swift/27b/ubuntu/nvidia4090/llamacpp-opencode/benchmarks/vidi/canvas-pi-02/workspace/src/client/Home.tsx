// Home (story 5, share.create): a "Create a board" button that asks the
// server for a fresh board (POST /api/boards) and navigates to it. The id is
// generated server-side, so there is no client-side id logic left.

import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { BoardCreateRateLimited, createBoard } from './api';

export function Home(): ReactElement {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createBoard();
      navigate(`/b/${id}`);
    } catch (e) {
      setCreating(false);
      if (e instanceof BoardCreateRateLimited) {
        setError("You're creating boards too quickly. Wait a minute and try again.");
      } else {
        setError("Couldn't create a board. Please try again.");
      }
    }
  };

  return (
    <div className="home">
      <h1 className="home-title">vidi6</h1>
      <p className="home-subtitle">A shared whiteboard for your team.</p>
      <button className="home-create" data-testid="create-board" onClick={onCreate} disabled={creating}>
        {creating ? 'Creating…' : 'Create a board'}
      </button>
      {error !== null && (
        <p className="home-error" data-testid="create-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
