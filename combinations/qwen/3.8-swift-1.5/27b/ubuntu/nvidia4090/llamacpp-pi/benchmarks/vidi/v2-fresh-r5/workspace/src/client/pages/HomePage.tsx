/**
 * Home page (story 5, share.create): product name, one-line description,
 * New board. Replaces the old auto-create redirect.
 */
import type { JSX } from 'react';
import { useCreateBoard } from './useCreateBoard';

export function HomePage(): JSX.Element {
  const { state, start } = useCreateBoard();

  return (
    <main
      data-testid="home-page"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 40, margin: 0, letterSpacing: '-0.5px' }}>vidi6</h1>
      <p style={{ fontSize: 16, color: '#5f6368', margin: 0 }}>
        A shared board for thinking together
      </p>
      <button
        type="button"
        data-testid="new-board-btn"
        disabled={state.kind === 'creating'}
        onClick={start}
        style={{
          fontSize: 16,
          fontWeight: 600,
          padding: '10px 24px',
          borderRadius: 8,
          border: 'none',
          background: '#2563eb',
          color: '#fff',
          cursor: state.kind === 'creating' ? 'default' : 'pointer',
          opacity: state.kind === 'creating' ? 0.7 : 1,
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" data-testid="create-error" style={{ color: '#d93025', margin: 0 }}>
          {state.message}
        </p>
      )}
    </main>
  );
}
