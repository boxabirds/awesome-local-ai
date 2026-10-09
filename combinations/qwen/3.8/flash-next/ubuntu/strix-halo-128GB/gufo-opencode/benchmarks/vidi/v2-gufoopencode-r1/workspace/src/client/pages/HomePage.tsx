import type { JSX } from 'react';
import { useCallback, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILURE_MESSAGE, type HomePageState } from './state';

// The New board action, shared by HomePage and the Board-not-found page so
// both offer exactly the same create behaviour.
export function useBoardCreate(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const inFlight = useRef(false);

  const create = useCallback((): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'creating' });
    const fail = (): void => {
      inFlight.current = false;
      setState({ kind: 'create_failed', message: CREATE_FAILURE_MESSAGE });
    };
    void createBoardRequest().then(
      (result) => {
        inFlight.current = false;
        if (result.kind === 'created') navigate(`/b/${result.id}`);
        else fail();
      },
      // createBoardRequest already folds network errors into `failed`; this
      // guard means even a hard rejection cannot leave the button stuck.
      fail
    );
  }, []);

  return { state, create };
}

// Shared frame for Home and Board-not-found: heading, one line, the New
// board button, and room for the create-failure message beneath it.
export function HomeLayout(props: {
  heading: string;
  tagline: string;
  state: HomePageState;
  onCreate: () => void;
  children?: React.ReactNode;
}): JSX.Element {
  const creating = props.state.kind === 'creating';
  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24
      }}
    >
      <h1 style={{ font: '600 40px system-ui, sans-serif', color: '#111827', margin: '0 0 4px' }}>
        {props.heading}
      </h1>
      <p style={{ font: '400 18px system-ui, sans-serif', color: '#4b5563', margin: '0 0 32px' }}>
        {props.tagline}
      </p>
      <button
        type="button"
        data-testid="new-board-button"
        style={{
          font: '600 16px system-ui, sans-serif',
          color: '#ffffff',
          background: '#2563eb',
          border: 'none',
          borderRadius: 8,
          padding: '12px 28px',
          opacity: creating ? 0.6 : 1,
          cursor: creating ? 'default' : 'pointer'
        }}
        disabled={creating}
        onClick={props.onCreate}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p role="alert" style={{ font: '500 14px system-ui, sans-serif', color: '#dc2626', margin: '12px 0 0', minHeight: 18 }}>
        {props.state.kind === 'create_failed' ? props.state.message : ''}
      </p>
      {props.children}
    </main>
  );
}

export function HomePage(): JSX.Element {
  const { state, create } = useBoardCreate();
  return (
    <HomeLayout heading="vidi6" tagline="A shared board for thinking together" state={state} onCreate={create} />
  );
}
