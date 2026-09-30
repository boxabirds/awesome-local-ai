import { useCreateBoard } from './useCreateBoard';

const mainStyle: React.CSSProperties = {
  width: '100vw',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  fontFamily: 'system-ui, sans-serif',
  background: '#F8FAFC',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 24px',
  fontSize: 16,
  fontWeight: 600,
  color: 'white',
  background: '#2563EB',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

/**
 * "Board not found" page (story 5, share.not_found): the user is not asked
 * what they did, the board simply is not there. Offers a fresh board and a
 * way back home.
 */
export function NotFoundPage() {
  const { state, onCreate } = useCreateBoard();

  return (
    <main style={mainStyle}>
      <h1 style={{ fontSize: 32, margin: 0 }}>Board not found</h1>
      <p style={{ fontSize: 16, color: '#475569', margin: 0 }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        type="button"
        style={{ ...buttonStyle, ...(state.kind === 'creating' ? { opacity: 0.7 } : null) }}
        onClick={() => {
          void onCreate();
        }}
        disabled={state.kind === 'creating'}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p role="alert" style={{ color: '#DC2626', margin: 0 }}>
          {state.message}
        </p>
      )}
      <a href="/" style={{ color: '#2563EB', fontSize: 14 }}>
        Back to home
      </a>
    </main>
  );
}
