import { useCreateBoard, CREATE_FAILED_TEXT, RATE_LIMITED_TEXT } from './useCreateBoard';
import type { ReactElement } from 'react';

/**
 * The "board not found" page (story 5, share.invalid_links): shown for
 * unknown, malformed and expired board ids alike. The board URL is the only
 * reference to a board, so a dead link must not be a dead end.
 */
export function NotFoundPage(): ReactElement {
  const { state, create } = useCreateBoard();
  return (
    <main
      data-testid="not-found-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 28, margin: 0 }}>Board not found</h1>
      <p style={{ color: '#555', margin: '0 0 16px' }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        type="button"
        data-testid="create-new-board-button"
        onClick={create}
        disabled={state === 'creating'}
        style={{
          padding: '10px 24px',
          fontSize: 16,
          borderRadius: 8,
          border: 'none',
          cursor: state === 'creating' ? 'default' : 'pointer',
          background: state === 'creating' ? '#9e9e9e' : '#1976d2',
          color: '#fff',
        }}
      >
        {state === 'creating' ? 'Creating…' : 'Create a new board'}
      </button>
      {state === 'create_failed' && (
        <p role="alert" data-testid="create-error" style={{ color: '#c62828' }}>
          {CREATE_FAILED_TEXT}
        </p>
      )}
      {state === 'rate_limited' && (
        <p role="alert" data-testid="create-error" style={{ color: '#c62828' }}>
          {RATE_LIMITED_TEXT}
        </p>
      )}
      <a href="/" data-testid="back-to-home" style={{ color: '#1976d2' }}>
        Back to home
      </a>
    </main>
  );
}
