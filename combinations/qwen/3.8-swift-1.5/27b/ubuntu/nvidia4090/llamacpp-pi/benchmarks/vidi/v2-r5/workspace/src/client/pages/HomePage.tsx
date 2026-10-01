// src/client/pages/HomePage.tsx
// Home page with New board button.

import { useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage(): ReactElement {
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

  const isCreating = state.kind === 'creating';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>vidi6</h1>
      <p style={{ fontSize: '1.1rem', color: '#555', marginBottom: '2rem' }}>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={isCreating}
        style={{
          fontSize: '1.1rem',
          padding: '0.75rem 2rem',
          cursor: isCreating ? 'not-allowed' : 'pointer',
          opacity: isCreating ? 0.7 : 1,
        }}
      >
        {isCreating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p style={{ color: '#c00', marginTop: '1rem' }}>{state.message}</p>
      )}
    </div>
  );
}
