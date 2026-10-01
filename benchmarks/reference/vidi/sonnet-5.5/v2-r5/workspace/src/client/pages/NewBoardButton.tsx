import { useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/** The New board action shared by the home and Board not found pages. */
export function NewBoardButton() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const busy = useRef(false);
  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'creating' });
    const res = await createBoardRequest();
    if (res.kind === 'created') {
      navigate(`/b/${res.id}`);
      return;
    }
    busy.current = false;
    setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
  };
  return (
    <>
      <button type="button" className="primary-button" disabled={state.kind === 'creating'} onClick={create}>
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      <p className="page-error" role="alert">{state.kind === 'create_failed' ? state.message : ''}</p>
    </>
  );
}
