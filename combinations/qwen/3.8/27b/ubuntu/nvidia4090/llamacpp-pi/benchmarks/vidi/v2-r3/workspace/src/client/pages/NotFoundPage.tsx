import type { ReactElement } from 'react';
import { navigate } from '../router';
import { useCreateBoard } from './state';

/**
 * The board-not-found page (story 5, share.not_found): an honest "not found"
 * — the id may be mistyped, or the board may never have existed. Recovery
 * actions: create a new board, or go back to the home page.
 */
export function NotFoundPage(): ReactElement {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#f3f5f8',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>Board not found</h1>
      <p style={{ color: '#555' }}>Check the link, or ask for it again.</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          onClick={create}
          disabled={creating}
          style={{
            padding: '10px 24px',
            fontSize: 16,
            borderRadius: 8,
            border: 'none',
            background: creating ? '#9ec5ff' : '#2563eb',
            color: '#fff',
            cursor: creating ? 'default' : 'pointer',
          }}
        >
          {creating ? 'Creating…' : 'New board'}
        </button>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          style={{
            padding: '10px 24px',
            fontSize: 16,
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            background: '#fff',
            color: '#334155',
            textDecoration: 'none',
          }}
        >
          Back to home
        </a>
      </div>
      {state.kind === 'create_failed' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          {state.message}
        </p>
      )}
    </main>
  );
}
