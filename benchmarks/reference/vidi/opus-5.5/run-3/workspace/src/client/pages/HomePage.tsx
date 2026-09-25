import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export const CREATE_FAILED_TEXT = "Couldn't create a board. Please try again.";
export const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";

type CreateState = 'idle' | 'creating' | 'failed' | 'rate_limited';

/**
 * The Create a board action (home page and Board not found page): POST, then open the new board.
 * On failure the person stays where they are, with a message and the button available again.
 */
export function useCreateBoard() {
  const [state, setState] = useState<CreateState>('idle');
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState('creating');
    const result = await createBoardRequest().catch(() => ({ kind: 'failed' as const }));
    busy.current = false;
    if (!mounted.current) return;
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    setState(result.kind === 'rate_limited' ? 'rate_limited' : 'failed');
  }, []);

  const message = state === 'failed' ? CREATE_FAILED_TEXT : state === 'rate_limited' ? RATE_LIMITED_TEXT : null;
  return { creating: state === 'creating', message, create };
}

/** The create button plus the space for its error message beneath it. */
export function CreateBoardButton(props: { label: string }) {
  const { creating, message, create } = useCreateBoard();
  return (
    <div className="create-board">
      <button type="button" className="page__primary" disabled={creating} aria-busy={creating} onClick={() => void create()}>
        {creating ? 'Creating…' : props.label}
      </button>
      <p className="page__error" role="alert">
        {message}
      </p>
    </div>
  );
}

export function HomePage() {
  return (
    <main className="page">
      <h1 className="page__title">vidi6</h1>
      <p className="page__text">A shared board for thinking together</p>
      <CreateBoardButton label="Create a board" />
    </main>
  );
}
