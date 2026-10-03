import type { JSX } from 'react';
import { useCreateBoard } from './state';

/**
 * Board not found page (share.not_found): clear message, an offer to create a
 * new board, and a link back to the home page. Nothing is created at a
 * mistyped address.
 */
export function NotFoundPage(): JSX.Element {
  const { state, start } = useCreateBoard();
  return (
    <div
      data-testid="not-found-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        background: '#FAFAFA',
        textAlign: 'center',
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>Board not found</h1>
      <p style={{ color: '#555', margin: '0 0 8px' }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
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
      <a href="/" style={{ color: '#2563EB' }}>
        Back to home
      </a>
    </div>
  );
}
