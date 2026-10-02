import React, { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage(): React.JSX.Element {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const handleCreate = useCallback(async () => {
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState({
        kind: 'create_failed',
        message: "Couldn't create a board. Please try again.",
      });
    }
  }, []);

  const disabled = state.kind === 'creating';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <button
        onClick={handleCreate}
        disabled={disabled}
        aria-label="New board"
        style={{ padding: '12px 24px', fontSize: '18px', cursor: disabled ? 'default' : 'pointer' }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" style={{ color: 'red', marginTop: '8px' }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
