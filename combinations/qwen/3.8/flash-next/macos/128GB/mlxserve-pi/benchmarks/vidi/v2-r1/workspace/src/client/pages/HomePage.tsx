import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/**
 * The home page: the product name, one line about it, and one way in — New
 * board (share.create). A click asks the service to create a board and, on
 * success, goes straight to it; on failure it says so and lets the person try
 * again, staying on home (share.create_failure).
 */

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  textAlign: 'center',
};

const actionStyle: CSSProperties = {
  padding: '12px 28px',
  borderRadius: 10,
  border: 'none',
  backgroundColor: '#4A90D9',
  color: '#fff',
  font: 'inherit',
  fontSize: 17,
  fontWeight: 600,
  cursor: 'pointer',
};

const errorStyle: CSSProperties = { color: '#B3261E', fontSize: 14, minHeight: 20 };

/**
 * The New board action, shared by the home page and the not-found page (which
 * offers the same way in): the create state machine plus its button and message.
 * A successful create navigates to the new board, so this only ever *renders*
 * idle, creating and create_failed.
 */
export function NewBoardControl(): ReactNode {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const create = useCallback((): void => {
    setState({ kind: 'creating' });
    createBoardRequest().then((result) => {
      if (result.kind === 'created') {
        // The board exists now; go to it. This is the only navigation the create
        // makes — a failure never moves anyone off the page (share.create_failure).
        navigate(`/b/${result.id}`);
        return;
      }
      setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    });
  }, []);

  // The button is only disabled while a create is in flight; a failure puts it
  // back (share.create_failure: "available again").
  const busy = state.kind === 'creating';

  return (
    <>
      <button
        type="button"
        data-testid="new-board-button"
        style={actionStyle}
        disabled={busy}
        aria-disabled={busy}
        onClick={create}
      >
        {busy ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' ? (
        <p data-testid="create-error" style={errorStyle} role="alert">
          {state.message}
        </p>
      ) : (
        <p data-testid="create-error" style={errorStyle} aria-hidden="true" />
      )}
    </>
  );
}

export function HomePage(): ReactNode {
  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ fontSize: 18, opacity: 0.75, margin: 0 }}>
        A shared board for thinking together
      </p>
      <NewBoardControl />
    </main>
  );
}
