import { useCreateBoard, CREATE_FAILED_TEXT, RATE_LIMITED_TEXT } from './useCreateBoard';
import type { ReactElement } from 'react';

/**
 * The home page (story 5, share.home): the app's landing view with a single
 * primary action — create a board and open it.
 */
export function HomePage(): ReactElement {
  const { state, create } = useCreateBoard();
  return (
    <main
      data-testid="home-page"
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
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ color: '#555', margin: '0 0 16px' }}>A shared board for thinking together</p>
      <button
        type="button"
        data-testid="create-board-button"
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
        {state === 'creating' ? 'Creating…' : 'Create a board'}
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
    </main>
  );
}
