import React, { useState, useCallback } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

export function HomePage() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const handleCreateBoard = useCallback(async () => {
    if (state.kind !== 'idle') return;

    setState({ kind: 'creating' });

    try {
      const result = await createBoardRequest();
      if (result.kind === 'created') {
        navigate(`/b/${result.id}`);
      } else {
        setState({
          kind: 'create_failed',
          message: "Couldn't create a board. Please try again.",
        });
      }
    } catch {
      setState({
        kind: 'create_failed',
        message: "Couldn't create a board. Please try again.",
      });
    }
  }, [state]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#f8f9fa',
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>vidi6</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>A shared board for thinking together</p>

      <button
        onClick={handleCreateBoard}
        disabled={state.kind === 'creating'}
        aria-label="New board"
        style={{
          padding: '12px 32px',
          fontSize: 16,
          fontWeight: 600,
          border: 'none',
          borderRadius: 8,
          background: state.kind === 'creating' ? '#ccc' : '#2563eb',
          color: '#fff',
          cursor: state.kind === 'creating' ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>

      {state.kind === 'create_failed' && (
        <p
          role="alert"
          style={{ marginTop: 16, color: '#dc2626', fontSize: 14 }}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
