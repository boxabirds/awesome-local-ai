import React, { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export function NotFoundPage(): React.ReactNode {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    if (result.kind === 'rate_limited') {
      setError("You're creating boards too quickly. Wait a minute and try again.");
    } else {
      setError("Couldn't create a board. Please try again.");
    }
    setCreating(false);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
        gap: '12px',
      }}
    >
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700 }}>Board not found</h1>
      <p style={{ color: '#555' }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        onClick={handleCreate}
        disabled={creating}
        style={{
          padding: '10px 28px',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: creating ? 'not-allowed' : 'pointer',
          borderRadius: '8px',
          border: 'none',
          background: '#4A90D9',
          color: '#fff',
          marginTop: '8px',
        }}
      >
        {creating ? 'Creating…' : 'Create a new board'}
      </button>
      {error && (
        <p style={{ color: '#d32f2f', fontSize: '0.9rem' }} role="alert">
          {error}
        </p>
      )}
      <a
        href="/"
        style={{ marginTop: '16px', color: '#4A90D9', textDecoration: 'underline' }}
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
      >
        Back to home
      </a>
    </div>
  );
}
