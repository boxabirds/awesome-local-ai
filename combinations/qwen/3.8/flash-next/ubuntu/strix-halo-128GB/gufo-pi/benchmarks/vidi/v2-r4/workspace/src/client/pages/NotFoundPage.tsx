import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

/**
 * Board not found page.
 */
export function NotFoundPage(): React.JSX.Element {
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setCreating(false);
    }
  }, []);

  return (
    <div className="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleCreate}
        disabled={creating}
        aria-label="New board"
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      <a href="/" aria-label="Back to home">Home</a>
    </div>
  );
}
