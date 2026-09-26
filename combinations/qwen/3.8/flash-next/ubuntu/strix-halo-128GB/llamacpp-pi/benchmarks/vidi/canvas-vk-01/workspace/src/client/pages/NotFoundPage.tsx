import { useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

/**
 * Board not found page: shown when a board link is invalid or does not exist.
 */
export function NotFoundPage(): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    setCreating(false);
    if (result.kind === 'rate_limited') {
      setError("You're creating boards too quickly. Wait a minute and try again.");
    } else {
      setError("Couldn't create a board. Please try again.");
    }
  };

  return (
    <div className="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <div className="not-found-actions">
        <button onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create a new board'}
        </button>
        <a href="/">Back to home</a>
      </div>
      {error !== null && (
        <p className="error-message" role="alert">{error}</p>
      )}
    </div>
  );
}
