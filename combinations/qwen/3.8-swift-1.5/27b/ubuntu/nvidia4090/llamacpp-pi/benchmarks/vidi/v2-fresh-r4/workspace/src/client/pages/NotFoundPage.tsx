/**
 * Board not found page: heading, guidance text, New board button, link home.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export function NotFoundPage(): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const handleCreate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setCreating(true);
    setError(null);

    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setError("Couldn't create a board. Please try again.");
      setCreating(false);
    }
    busyRef.current = false;
  }, []);

  return (
    <div className="not-found-page" data-vidi6="not-found-page">
      <h1 data-vidi6="not-found-heading">Board not found</h1>
      <p data-vidi6="not-found-text">
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        data-vidi6="not-found-new-board"
        onClick={handleCreate}
        disabled={creating}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {error && (
        <p data-vidi6="not-found-error" role="alert">
          {error}
        </p>
      )}
      <a href="/" data-vidi6="not-found-home-link">
        Back to home
      </a>
    </div>
  );
}
