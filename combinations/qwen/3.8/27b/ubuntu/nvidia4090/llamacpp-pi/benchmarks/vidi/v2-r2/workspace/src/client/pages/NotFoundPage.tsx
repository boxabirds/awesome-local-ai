/**
 * Board not found page (story 5, share.not_found): shown for unknown links
 * AND malformed ids (indistinguishable), and after a failed create.
 *
 * Copy (PRD): "Board not found" / "Check the link, or ask the person who
 * shared it to send it again." / New board button / back-to-home link.
 */

import type { JSX } from 'react';
import { useCreateBoard } from './HomePage';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <div
      data-testid="board-not-found"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#f8f8f6',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>Board not found</h1>
      <p style={{ color: '#555', fontSize: 16, margin: 0 }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        data-testid="new-board-button"
        onClick={create}
        disabled={creating}
        style={{
          marginTop: 8,
          padding: '12px 28px',
          fontSize: 16,
          fontWeight: 600,
          color: '#fff',
          background: '#111',
          border: 'none',
          borderRadius: 8,
          cursor: creating ? 'default' : 'pointer',
        }}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      <div style={{ height: 24 }} aria-live="polite">
        {state.kind === 'create_failed' ? (
          <p role="alert" data-testid="create-error" style={{ color: '#b00020', margin: 0, fontSize: 14 }}>
            {state.message}
          </p>
        ) : null}
      </div>
      <a
        data-testid="back-home"
        href="/"
        style={{ color: '#555', fontSize: 14, textDecoration: 'underline' }}
      >
        Back to home
      </a>
    </div>
  );
}
