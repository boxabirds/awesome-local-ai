import React, { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function NotFoundPage(): React.JSX.Element {
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
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleCreate}
        disabled={disabled}
        aria-label="New board"
        style={{ padding: '12px 24px', fontSize: '18px', cursor: disabled ? 'default' : 'pointer', marginTop: '16px' }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" style={{ color: 'red', marginTop: '8px' }}>
          {state.message}
        </p>
      )}
      <a href="/" style={{ marginTop: '16px' }}>Back to home</a>
    </div>
  );
}
