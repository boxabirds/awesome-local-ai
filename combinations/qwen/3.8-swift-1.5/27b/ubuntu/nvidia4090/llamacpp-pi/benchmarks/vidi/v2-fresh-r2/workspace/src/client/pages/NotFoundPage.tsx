/**
 * Board not found page (story 5, share.not_found): shown for links whose
 * code does not belong to an existing board (or is malformed). Nothing is
 * created at the mistyped address; the New board button reuses the shared
 * create action.
 */
import type { JSX } from 'react';
import { useCreateBoard } from './state';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <main
      data-testid="not-found-page"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#fafafa',
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>Board not found</h1>
      <p style={{ fontSize: 16, color: '#555', margin: 0 }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        data-testid="new-board"
        onClick={create}
        disabled={creating}
        style={{
          marginTop: 8,
          padding: '10px 24px',
          fontSize: 16,
          borderRadius: 8,
          border: 'none',
          backgroundColor: creating ? '#bbb' : '#1a73e8',
          color: 'white',
          cursor: creating ? 'default' : 'pointer',
        }}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" data-testid="create-error" style={{ color: '#d93025' }}>
          {state.message}
        </p>
      )}
      <a href="/" style={{ color: '#1a73e8', fontSize: 14 }}>
        Back to home
      </a>
    </main>
  );
}
