import { useCreateBoard } from './useCreateBoard';

/**
 * Story 5: home page (share.home). Product name + tagline + New board
 * button; creation shows "Creating…", failure shows the exact message.
 */
export function HomePage() {
  const { state, start } = useCreateBoard();

  return (
    <div
      data-testid="home-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 48, marginBottom: 8 }}>vidi6</h1>
      <p style={{ fontSize: 18, color: '#555', marginBottom: 32 }}>
        A shared board for thinking together
      </p>
      <button
        data-testid="new-board-button"
        onClick={start}
        disabled={state.kind === 'creating'}
        style={{
          fontSize: 18,
          padding: '12px 24px',
          cursor: state.kind === 'creating' ? 'default' : 'pointer',
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" data-testid="create-error" style={{ color: '#c0392b', marginTop: 16 }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
