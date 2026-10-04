/**
 * Board not found page (story 5, share.not_found): shown for unknown and
 * malformed board links. Creates nothing — offers a fresh board and a way
 * back home.
 */
import type { JSX } from 'react';
import { navigate } from '../router';
import { useCreateBoard } from './useCreateBoard';

export function NotFoundPage(): JSX.Element {
  const { state, start } = useCreateBoard();

  return (
    <main
      data-testid="not-found-page"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 28, margin: 0 }}>Board not found</h1>
      <p style={{ fontSize: 15, color: '#5f6368', margin: 0 }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        type="button"
        data-testid="new-board-btn"
        disabled={state.kind === 'creating'}
        onClick={start}
        style={{
          fontSize: 15,
          fontWeight: 600,
          padding: '8px 20px',
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
      <a
        href="/"
        data-testid="back-home-link"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
        style={{ fontSize: 14, color: '#5f6368' }}
      >
        Back to home
      </a>
    </main>
  );
}
