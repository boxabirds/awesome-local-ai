// Home page: product name, one sentence, and one call to action. The create
// action is exported so NotFoundPage's "Create a new board" reuses it verbatim.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest, type CreateResponse } from '../api';
import { navigate } from '../router';

export const ERROR_CREATE_MESSAGE = "Couldn't create a board. Please try again.";
export const ERROR_RATE_LIMIT_MESSAGE = "You're creating boards too quickly. Wait a minute and try again.";

export type CreatePhase = 'idle' | 'creating' | 'failed' | 'rate_limited';

/** Create a board then navigate to it; failures become page state, never throws. */
export function useCreateBoardAction() {
  const [phase, setPhase] = useState<CreatePhase>('idle');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useCallback(async (): Promise<void> => {
    setPhase('creating');
    // createBoardRequest never throws by contract; the guard keeps a future
    // change from stranding the button in "Creating…" forever.
    let response: CreateResponse;
    try {
      response = await createBoardRequest();
    } catch {
      response = { kind: 'failed' };
    }
    if (!mounted.current) return;
    if (response.kind === 'created') {
      navigate(`/b/${encodeURIComponent(response.id)}`);
      return;
    }
    setPhase(response.kind === 'rate_limited' ? 'rate_limited' : 'failed');
  }, []);

  return { phase, create };
}

export function HomePage() {
  const { phase, create } = useCreateBoardAction();
  const creating = phase === 'creating';
  return (
    <main className="page home-page">
      <div className="home-card">
        <h1 className="wordmark">vidi6</h1>
        <p className="tagline">A shared board for thinking together</p>
        <button
          type="button"
          className="create-board-button"
          disabled={creating}
          aria-busy={creating}
          onClick={() => void create()}
        >
          {creating ? 'Creating…' : 'Create a board'}
        </button>
        {phase === 'failed' || phase === 'rate_limited' ? (
          <p className="home-error" role="alert">
            {phase === 'failed' ? ERROR_CREATE_MESSAGE : ERROR_RATE_LIMIT_MESSAGE}
          </p>
        ) : null}
      </div>
    </main>
  );
}
