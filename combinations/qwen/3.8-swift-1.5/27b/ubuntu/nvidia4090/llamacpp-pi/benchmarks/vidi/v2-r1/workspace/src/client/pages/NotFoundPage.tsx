import { navigate } from '../router';
import { useCreateBoard } from './state';

/**
 * Board not found page (share.not_found): a clear heading and guidance, a New
 * board button (reusing the home page create action), and a link back to the
 * home page. Nothing is created at a mistyped address.
 */
export function NotFoundPage() {
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
        <h1 data-testid="not-found-heading" style={{ fontSize: 32, marginBottom: 8 }}>
          Board not found
        </h1>
        <p style={{ fontSize: 16, color: '#bbb', marginBottom: 32 }}>
          Check the link, or ask the person who shared it to send it again.
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
        <div style={{ marginTop: 24 }}>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            style={{ color: '#4f8cff', fontSize: 14 }}
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
