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

/** Home page (story 5): the entry point with the "New board" button. */
export function HomePage() {
  const { state, onCreate } = useCreateBoard();

  return (
    <main style={mainStyle}>
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ fontSize: 18, color: '#475569', margin: 0 }}>A shared board for thinking together</p>
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
    </main>
  );
}
