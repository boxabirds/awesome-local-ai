/**
 * Story 5: home page — product name, one-line description and the
 * Create a board action (share.create). Error message space lives beneath
 * the button (share.create_failure, share.rate_limit).
 */
import type { JSX } from 'react';
import { useCreateBoard } from './useCreateBoard';

// Exact PRD copy (share.create_failure / share.rate_limit).
const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";
const RATE_LIMIT_MESSAGE = "You're creating boards too quickly. Wait a minute and try again.";

export function HomePage(): JSX.Element {
  const { status, create } = useCreateBoard();

  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: '#111827',
        color: '#F9FAFB',
      }}
    >
      <h1 style={{ fontSize: 40, fontWeight: 700 }}>vidi6</h1>
      <p style={{ fontSize: 18, color: '#D1D5DB' }}>A shared board for thinking together</p>
      <button
        data-testid="create-board-button"
        onClick={() => void create()}
        disabled={status === 'creating'}
        style={{
          marginTop: 12,
          padding: '12px 24px',
          fontSize: 16,
          fontWeight: 600,
          color: '#111827',
          background: '#34D399',
          border: 'none',
          borderRadius: 8,
          cursor: status === 'creating' ? 'default' : 'pointer',
        }}
      >
        {status === 'creating' ? 'Creating…' : 'Create a board'}
      </button>
      {status === 'failed' && (
        <p role="alert" data-testid="create-failure-message" style={{ color: '#FCA5A5' }}>
          {CREATE_FAILURE_MESSAGE}
        </p>
      )}
      {status === 'rate_limited' && (
        <p role="alert" data-testid="rate-limit-message" style={{ color: '#FCD34D' }}>
          {RATE_LIMIT_MESSAGE}
        </p>
      )}
    </main>
  );
}
