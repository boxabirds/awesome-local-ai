import { navigate } from '../router';
import { useCreateBoard } from './useCreateBoard';

/**
 * Story 5: board-not-found page (share.not_found). Shown for unknown and
 * malformed board links; offers New board and a link back home.
 */
export function NotFoundPage() {
  const { state, start } = useCreateBoard();

  return (
    <div
      data-testid="not-found-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>Board not found</h1>
      <p style={{ fontSize: 16, color: '#555', marginBottom: 32 }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        data-testid="new-board-button"
        onClick={start}
        disabled={state.kind === 'creating'}
        style={{
          fontSize: 18,
          padding: '12px 24px',
          cursor: state.kind === 'creating' ? 'default' : 'pointer',
          marginBottom: 16,
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" data-testid="create-error" style={{ color: '#c0392b', marginBottom: 16 }}>
          {state.message}
        </p>
      )}
      <a href="/" onClick={() => navigate('/')}>
        Back to home
      </a>
    </div>
  );
}
