import type { JSX } from 'react';
import { useCreateBoard } from './state';

/**
 * Home page (story 5): product name, one-line description, New board button,
 * and space for a creation error message beneath the button.
 */
export function HomePage(): JSX.Element {
  const { state, start } = useCreateBoard();
  return (
    <div
      data-testid="home-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        background: '#FAFAFA',
      }}
    >
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ color: '#555', margin: '0 0 8px' }}>A shared board for thinking together</p>
      <button
        type="button"
        data-testid="new-board-button"
        onClick={start}
        disabled={state.kind === 'creating'}
        style={{
          padding: '10px 24px',
          fontSize: 16,
          borderRadius: 8,
          border: 'none',
          background: '#2563EB',
          color: '#fff',
          cursor: state.kind === 'creating' ? 'default' : 'pointer',
          opacity: state.kind === 'creating' ? 0.7 : 1,
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" data-testid="create-error" style={{ color: '#DC2626', margin: 0 }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
