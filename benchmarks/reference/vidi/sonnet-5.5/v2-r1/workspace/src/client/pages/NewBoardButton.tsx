import { useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE } from './state';
import type { HomePageState } from './state';

/** The create action shared by the Home and Board not found pages. */
export function NewBoardButton() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = async () => {
    if (state.kind === 'creating') return;
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else if (mounted.current) {
      setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    }
  };

  return (
    <>
      <button type="button" className="primary-button" disabled={state.kind === 'creating'} onClick={create}>
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p className="page-error" role="alert">
          {state.message}
        </p>
      )}
    </>
  );
}
