import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/** The New board action (share.create), shared by the Home and Board not found pages. */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const create = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'creating' });
    void createBoardRequest().then((result) => {
      busy.current = false;
      if (!mounted.current) return;
      if (result.kind === 'created') navigate(`/b/${result.id}`);
      else setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    });
  }, []);
  return { state, create };
}

export function NewBoardButton(props: { state: HomePageState; onCreate: () => void }): React.JSX.Element {
  const creating = props.state.kind === 'creating';
  return (
    <div className="new-board">
      <button type="button" className="primary-button" onClick={props.onCreate} disabled={creating}>
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p className="new-board-error" role="alert">
        {props.state.kind === 'create_failed' ? props.state.message : ''}
      </p>
    </div>
  );
}

export function HomePage(): React.JSX.Element {
  const { state, create } = useCreateBoard();
  return (
    <main className="page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-text">A shared board for thinking together</p>
      <NewBoardButton state={state} onCreate={create} />
    </main>
  );
}
