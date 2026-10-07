/**
 * Home page — product name, description, and New board button.
 * Story 5 — share a board with others using a link.
 */
import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { navigate, useRoute } from '../router';
import { createBoardRequest } from '../api';
import type { CreateResponse } from '../api';
import type { HomePageState } from './state';

export function HomePage(): ReactNode {
  const route = useRoute();
  // If navigating to /b/:id from home after creation, we're redirected via navigate()
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const handleCreateBoard = useCallback(async () => {
    if (state.kind === 'creating') return;
    setState({ kind: 'creating' });
    try {
      const result: CreateResponse = await createBoardRequest();
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

  if (route.name !== 'home') return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      background: '#f8f9fa',
    }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>vidi6</h1>
      <p style={{ color: '#6c757d', marginBottom: '2rem', fontSize: '1.1rem' }}>
        A shared board for thinking together
      </p>
      <button
        onClick={handleCreateBoard}
        disabled={state.kind === 'creating'}
        data-testid="new-board-btn"
        style={{
          padding: '12px 32px',
          fontSize: '1.1rem',
          fontWeight: 600,
          border: 'none',
          borderRadius: '8px',
          background: state.kind === 'creating' ? '#adb5bd' : '#007bff',
          color: '#fff',
          cursor: state.kind === 'creating' ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
        }}
        aria-label="New board"
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p
          data-testid="creation-error"
          style={{ marginTop: '1rem', color: '#dc3545', textAlign: 'center' }}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
