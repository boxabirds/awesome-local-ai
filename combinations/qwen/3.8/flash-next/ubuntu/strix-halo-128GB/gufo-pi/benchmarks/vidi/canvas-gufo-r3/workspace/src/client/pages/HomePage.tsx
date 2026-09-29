import React, { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

type HomeState = 'idle' | 'creating' | 'failed' | 'rate_limited';

export function HomePage(): React.ReactNode {
  const [state, setState] = useState<HomeState>('idle');

  const handleCreate = useCallback(async () => {
    setState('creating');
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    if (result.kind === 'rate_limited') {
      setState('rate_limited');
      return;
    }
    setState('failed');
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
        gap: '16px',
      }}
    >
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>vidi6</h1>
      <p style={{ color: '#555', fontSize: '1.1rem' }}>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={state === 'creating'}
        style={{
          padding: '12px 32px',
          fontSize: '1.1rem',
          fontWeight: 600,
          cursor: state === 'creating' ? 'not-allowed' : 'pointer',
          borderRadius: '8px',
          border: 'none',
          background: '#4A90D9',
          color: '#fff',
          marginTop: '16px',
        }}
      >
        {state === 'creating' ? 'Creating…' : 'Create a board'}
      </button>
      {state === 'failed' && (
        <p style={{ color: '#d32f2f', fontSize: '0.95rem' }} role="alert">
          Couldn't create a board. Please try again.
        </p>
      )}
      {state === 'rate_limited' && (
        <p style={{ color: '#d32f2f', fontSize: '0.95rem' }} role="alert">
          You're creating boards too quickly. Wait a minute and try again.
        </p>
      )}
    </div>
  );
}
