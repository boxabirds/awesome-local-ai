import type { ReactElement } from 'react';
import { useCreateBoard } from './state';

/**
 * The home page (story 5, share.create): the product name and one action —
 * "New board". While the request is in flight the button is disabled; on
 * failure the retry message is shown and the button stays usable.
 */
export function HomePage(): ReactElement {
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
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ color: '#555' }}>A shared board for thinking together.</p>
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
      {state.kind === 'create_failed' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          {state.message}
        </p>
      )}
    </main>
  );
}
