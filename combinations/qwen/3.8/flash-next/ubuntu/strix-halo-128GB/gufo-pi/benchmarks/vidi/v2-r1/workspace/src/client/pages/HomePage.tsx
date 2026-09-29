/**
 * Home page: product name, description, New board button.
 */
import { useCallback, useState } from 'react';
import type { JSX } from 'react';

import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage(): JSX.Element {
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
      <h1 style={{ fontSize: '2rem', margin: '0 0 0.25rem' }}>vidi6</h1>
      <p style={{ color: '#555', margin: '0 0 2rem' }}>A shared board for thinking together</p>
      <button
        type="button"
        data-testid="new-board"
        disabled={state.kind === 'creating'}
        onClick={handleCreate}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.125rem',
          cursor: state.kind === 'creating' ? 'default' : 'pointer',
          borderRadius: 8,
          border: 'none',
          background: '#2563eb',
          color: '#fff',
        }}
      >
        {state.kind === 'creating' ? 'Creating\u2026' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p data-testid="create-error" style={{ color: '#dc2626', marginTop: '1rem' }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
