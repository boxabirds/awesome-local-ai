import { useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/** The New board action shared by the home and not-found pages. */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const create = () => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'creating' });
    void createBoardRequest().then((res) => {
      busy.current = false;
      if (res.kind === 'created') {
        navigate(`/b/${res.id}`);
      } else if (mounted.current) {
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      }
    });
  };
  return { state, create };
}

export function NewBoardButton({ state, create }: { state: HomePageState; create: () => void }) {
  const creating = state.kind === 'creating';
  return (
    <>
      <button type="button" className="primary-button" disabled={creating} onClick={create}>
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p className="page-error" role="alert">{state.kind === 'create_failed' ? state.message : ''}</p>
    </>
  );
}

export function HomePage() {
  const { state, create } = useCreateBoard();
  return (
    <main className="page page--home">
      <h1>vidi6</h1>
      <p>A shared board for thinking together</p>
      <NewBoardButton state={state} create={create} />
    </main>
  );
}
