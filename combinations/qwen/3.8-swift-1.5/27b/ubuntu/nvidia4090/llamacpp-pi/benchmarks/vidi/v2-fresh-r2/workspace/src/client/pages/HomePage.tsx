/**
 * Home page (story 5): product name, one-line description, New board.
 *
 * idle → creating ("Creating…", button disabled) → navigate to /b/<id> on
 * success; on failure the message "Couldn't create a board. Please try
 * again." appears under the button and the button is enabled again.
 */
import type { JSX } from 'react';
import { useCreateBoard } from './state';

export function HomePage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <main
      data-testid="home-page"
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
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ fontSize: 18, color: '#555', margin: 0 }}>
        A shared board for thinking together
      </p>
      <button
        data-testid="new-board"
        onClick={create}
        disabled={creating}
        style={{
          marginTop: 12,
          padding: '12px 28px',
          fontSize: 18,
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
    </main>
  );
}
