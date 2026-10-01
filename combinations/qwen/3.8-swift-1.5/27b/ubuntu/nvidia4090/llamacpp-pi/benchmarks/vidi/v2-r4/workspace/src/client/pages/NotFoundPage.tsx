import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function NotFoundPage() {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Board not found</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleCreate}
        disabled={state.kind === 'creating'}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          cursor: state.kind === 'creating' ? 'not-allowed' : 'pointer',
          opacity: state.kind === 'creating' ? 0.7 : 1,
          marginBottom: '1rem',
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p style={{ color: '#c00', marginBottom: '1rem' }} role="alert">{state.message}</p>
      )}
      <a href="/" style={{ color: '#06c', fontSize: '0.9rem' }}>Back to home</a>
    </div>
  );
}
