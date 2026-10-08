/**
 * Home page (story 5, share.create): product name, tagline and the New board
 * button. One click → POST /api/boards → navigate to the board link.
 *
 * - While creating: the button shows "Creating…" and is disabled (no
 *   duplicate creations).
 * - On failure (500 or network): the error message shows under the button
 *   and the button re-enables; nothing is navigated to.
 */

import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

/** PRD copy for the create-failed state (share.create). */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/**
 * Hook exported for the component tests (TC-16/TC-17): wraps the create
 * request in the home page state machine.
 */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const busyRef = useRef(false);

  const create = useCallback((): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setState({ kind: 'creating' });
    void (async () => {
      try {
        const result = await createBoardRequest();
        busyRef.current = false;
        if (result.kind === 'created') {
          // Navigate BEFORE any further state update: a reload of the new
          // link works even if the create response raced (share.privacy).
          navigate(`/b/${result.id}`);
          return;
        }
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      } catch {
        // Defensive: the API client maps every failure to { kind: 'failed' },
        // but the page must recover from an unexpected rejection too.
        busyRef.current = false;
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      }
    })();
  }, []);

  return { state, create };
}

export function HomePage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <div
      data-testid="home-page"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#f8f8f6',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 40, margin: 0 }}>vidi6</h1>
      <p style={{ color: '#555', fontSize: 16, margin: 0 }}>A shared board for thinking together</p>
      <button
        data-testid="new-board-button"
        onClick={create}
        disabled={creating}
        style={{
          marginTop: 12,
          padding: '12px 28px',
          fontSize: 16,
          fontWeight: 600,
          color: '#fff',
          background: '#111',
          border: 'none',
          borderRadius: 8,
          cursor: creating ? 'default' : 'pointer',
        }}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      <div style={{ height: 24, width: '100%', textAlign: 'center' }} aria-live="polite">
        {state.kind === 'create_failed' ? (
          <p role="alert" data-testid="create-error" style={{ color: '#b00020', margin: 0, fontSize: 14 }}>
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
