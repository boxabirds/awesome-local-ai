// Story 5 (share.pages): the Home page. One action — create a board and
// open it. Failed creation stays on Home with the PRD message.

import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

export function NewBoardButton() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const create = useCallback(() => {
    setState({ kind: 'creating' });
    void createBoardRequest()
      .then((result) => {
        if (result.kind === 'created') {
          navigate(`/b/${result.id}`);
        } else {
          setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
        }
      })
      .catch(() => setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE }));
  }, []);

  return (
    <>
      <button type="button" onClick={create} disabled={state.kind === 'creating'}>
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && <p role="alert">{state.message}</p>}
    </>
  );
}

export function HomePage() {
  return (
    <main className="page home-page">
      <h1>vidi6</h1>
      <p className="tagline">A shared board for thinking together</p>
      <NewBoardButton />
    </main>
  );
}
