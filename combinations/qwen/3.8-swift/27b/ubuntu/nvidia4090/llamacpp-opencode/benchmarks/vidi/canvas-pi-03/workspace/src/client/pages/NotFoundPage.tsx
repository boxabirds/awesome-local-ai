/**
 * Story 5: Board not found page (share.not_found). Shown for unknown board
 * links, malformed ids and any other path. Nothing is created at a mistyped
 * address; the page offers to start a fresh board (reusing the home page's
 * create action) and links back home.
 */
import type { JSX } from 'react';
import { navigate } from '../router';
import { useCreateBoard } from './useCreateBoard';

export function NotFoundPage(): JSX.Element {
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
      <h1 style={{ fontSize: 32, fontWeight: 700 }}>Board not found</h1>
      <p style={{ fontSize: 16, color: '#D1D5DB' }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        data-testid="create-new-board-button"
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
        {status === 'creating' ? 'Creating…' : 'Create a new board'}
      </button>
      {status === 'failed' && (
        <p role="alert" data-testid="create-failure-message" style={{ color: '#FCA5A5' }}>
          Couldn't create a board. Please try again.
        </p>
      )}
      {status === 'rate_limited' && (
        <p role="alert" data-testid="rate-limit-message" style={{ color: '#FCD34D' }}>
          You're creating boards too quickly. Wait a minute and try again.
        </p>
      )}
      <a
        data-testid="back-to-home"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
        style={{ fontSize: 14, color: '#9CA3AF', textDecoration: 'underline' }}
      >
        Back to home
      </a>
    </main>
  );
}
