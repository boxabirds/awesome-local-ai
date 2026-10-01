// The home page: the product's name, one sentence, and a button that makes a board.
//
// This is the only place a board comes from. Story 3 minted an id in the browser and
// rewrote the address bar, which meant an address could name a board the service had
// never heard of - the exact confusion this story exists to remove. So the click
// here waits for the service to say `201` before the address changes: the address a
// person ends up with always names a board that was created.
//
// The state machine is `HomePageState` (see ./state.ts): a click goes to `creating`
// - the button reads "Creating…" and is disabled, so a second click cannot make a
// second board - and from there either the address changes or the reason appears
// under the button and the click is available again.

import { useCallback, useRef, useState, type JSX } from 'react';
import { createBoardRequest, type CreateResponse } from '../api';
import { boardPath, navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/**
 * The New board action, so the Board not found page can offer the same one rather
 * than a copy of it (the PRD asks for a New board button there too).
 */
export function useCreateBoard(): { state: HomePageState; create(): void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  /**
   * The answer this hook last asked for. A response that arrives after the person
   * left the page is not news to anyone: it must not navigate them somewhere, and
   * it must not overwrite a newer click's state.
   */
  const asked = useRef(0);

  const create = useCallback((): void => {
    const mine = ++asked.current;
    setState({ kind: 'creating' });
    void (async () => {
      let response: CreateResponse;
      try {
        response = await createBoardRequest();
      } catch (error) {
        // The API client is meant to answer rather than throw; if it ever throws,
        // that is a failed creation like any other, not a stack trace.
        console.error(JSON.stringify({ event: 'board_create_threw', error: String(error) }));
        response = { kind: 'failed' };
      }
      if (asked.current !== mine) return;
      if (response.kind === 'created') {
        // The board exists, so the address may now name it.
        navigate(boardPath(response.id));
        // The route changed underneath this hook, so its own state is gone with it;
        // there is nothing to put the board page's answer into.
        return;
      }
      setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    })();
  }, []);

  return { state, create };
}

export function HomePage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <main className="notice-page" data-testid="home-page">
      <div className="notice-card">
        <h1 className="notice-title">vidi6</h1>
        <p className="notice-line">A shared board for thinking together</p>
        <button
          type="button"
          className="notice-button"
          data-testid="new-board"
          onClick={create}
          disabled={creating}
        >
          {/* The label says what is happening, so a slow service is a explained
              pause rather than a dead button. */}
          {creating ? 'Creating…' : 'New board'}
        </button>
        {/* The space under the button is always there; only the words come and go. */}
        <p className="notice-under" data-testid="home-under" role={creating ? 'status' : undefined}>
          {state.kind === 'create_failed' ? state.message : ''}
        </p>
        <p className="notice-foot">
          A board is reached by its link. Anyone you send the link to can open it and
          edit; nobody else can find it.
        </p>
      </div>
    </main>
  );
}
