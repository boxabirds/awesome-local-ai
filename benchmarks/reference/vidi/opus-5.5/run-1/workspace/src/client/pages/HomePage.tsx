import { useCallback, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export const PRODUCT_NAME = 'vidi6';
export const TAGLINE = 'A shared board for thinking together';
export const CREATE_FAILED_TEXT = "Couldn't create a board. Please try again.";
export const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";
export const CREATING_TEXT = 'Creating…';

type CreateState = 'idle' | 'creating' | 'failed' | 'rate_limited';

/**
 * The create action shared by the home page and Board not found: Idle → Creating → (navigate
 * to the new board | CreateFailed | RateLimited); the button is usable again after a failure.
 */
export function useCreateBoard(): { state: CreateState; create: () => void; error: string | null } {
  const [state, setState] = useState<CreateState>('idle');
  // A ref, not state: a double click must not send two requests before the re-render.
  const inFlight = useRef(false);
  const create = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState('creating');
    void createBoardRequest().then((res) => {
      inFlight.current = false;
      if (res.kind === 'created') {
        navigate(`/b/${res.id}`);
        return;
      }
      setState(res.kind === 'rate_limited' ? 'rate_limited' : 'failed');
    });
  }, []);
  const error = state === 'failed' ? CREATE_FAILED_TEXT : state === 'rate_limited' ? RATE_LIMITED_TEXT : null;
  return { state, create, error };
}

/** The button plus the space beneath it for an error message. */
export function CreateBoardButton({ label }: { label: string }) {
  const { state, create, error } = useCreateBoard();
  const creating = state === 'creating';
  return (
    <div className="create-board">
      <button type="button" className="primary-button" onClick={create} disabled={creating} aria-busy={creating}>
        {creating ? CREATING_TEXT : label}
      </button>
      <p className="create-board__error" role="alert">
        {error}
      </p>
    </div>
  );
}

export function HomePage() {
  return (
    <main className="page page--home">
      <h1 className="page__title">{PRODUCT_NAME}</h1>
      <p className="page__text">{TAGLINE}</p>
      <CreateBoardButton label="Create a board" />
    </main>
  );
}
