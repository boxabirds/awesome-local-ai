import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { boardPath, navigate } from '../router';
import { nextHomePageState, type HomePageState } from './state';

/**
 * The home page (PRD share.home_page): the product, one sentence, and the one thing
 * a first-time visitor can do — "New board".
 *
 * It is the only place a board is made. A board exists from the moment the server
 * confirms it, which is why an address nobody handed out leads nowhere: guessing one
 * is the one thing this page does not do.
 */
export function HomePage() {
  return (
    <main className="page" data-testid="home-page">
      <div className="page-card">
        <h1>vidi6</h1>
        <p className="page-lede">A shared board for thinking together.</p>
        <NewBoardButton />
      </div>
    </main>
  );
}

/**
 * The button, and the message under it while it cannot do what was asked. Exported
 * because the "Board not found" page offers the same way out of a dead link
 * (PRD share.not_found) — the same rules, not a copy of them.
 */
export function NewBoardButton({ className = 'primary-button' }: { className?: string }) {
  const { state, onCreate } = useCreateBoard();
  return (
    <>
      <button
        type="button"
        className={className}
        data-testid="new-board-button"
        onClick={onCreate}
        // Disabled while a creation is under way: a second click must not make a
        // second board (PRD share.create_more).
        disabled={state.kind === 'creating'}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' ? (
        <p className="page-error" role="alert" data-testid="create-error">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

/** The home page's state machine, wired to the API (design "State diagrams"). */
export function useCreateBoard(): { state: HomePageState; onCreate: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  // The state is read when the answer arrives, which is after the click, so it is
  // kept in a ref rather than captured by the callback.
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const start = useCallback(async () => {
    const started = nextHomePageState(stateRef.current, { type: 'click' });
    if (started.kind !== 'creating') return; // one creation at a time
    setState(started);
    const result = await createBoardRequest();
    // The answer may arrive after this page was left behind for a board it just
    // created, or after a test unmounted it.
    if (!mounted.current) return;
    const settled = nextHomePageState(
      stateRef.current,
      result.kind === 'created' ? { type: 'created' } : { type: 'failed' },
    );
    setState(settled);
    // Only a created board may send the address bar somewhere (TC-16).
    if (result.kind === 'created') navigate(boardPath(result.id));
  }, []);

  // `start` waits for the server; a click handler must not return a promise.
  const onCreate = useCallback(() => {
    void start();
  }, [start]);

  return { state, onCreate };
}
