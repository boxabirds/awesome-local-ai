import { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>vidi6</h1>
      <p style={{ fontSize: '1rem', color: '#666', marginBottom: '2rem' }}>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={state.kind === 'creating'}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          cursor: state.kind === 'creating' ? 'not-allowed' : 'pointer',
          opacity: state.kind === 'creating' ? 0.7 : 1,
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p style={{ color: '#c00', marginTop: '1rem' }} role="alert">{state.message}</p>
      )}
    </div>
  );
}
