import { useCreateBoard } from './state';

/**
 * Home page (share.pages): product name, one-line description, a prominent
 * New board button, and space for the creation-failure message beneath it.
 */
export function HomePage() {
  const { state, startCreate } = useCreateBoard();

  const creating = state.kind === 'creating';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 40, marginBottom: 8 }}>vidi6</h1>
        <p style={{ fontSize: 16, color: '#bbb', marginBottom: 32 }}>
          A shared board for thinking together
        </p>
        <button
          data-testid="new-board"
          onClick={startCreate}
          disabled={creating}
          style={{
            fontSize: 18,
            padding: '12px 32px',
            borderRadius: 8,
            border: 'none',
            background: creating ? '#555' : '#4f8cff',
            color: '#fff',
            cursor: creating ? 'default' : 'pointer',
          }}
        >
          {creating ? 'Creating…' : 'New board'}
        </button>
        {state.kind === 'create_failed' && (
          <p data-testid="create-error" style={{ color: '#ff9c9c', marginTop: 16 }}>
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
