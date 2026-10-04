/**
 * The vidi6 home page (story 5, `share.pages`).
 *
 * One product name, one sentence, one action. Clicking New board asks the service
 * for a fresh board and, on success, moves to it; on failure the person stays
 * here with the button ready to try again and the exact PRD message beneath
 * (share.create, share.create_failure).
 */

import { useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/** The product's one-line description (PRD: home page). */
export const HOME_TAGLINE = 'A shared board for thinking together';

export interface NewBoardButtonProps {
  /** Where to send the state, so a page can show the failure message under the button. */
  onState?: (state: HomePageState) => void;
}

/**
 * The "New board" action, shared by the home page and Board not found (which
 * offers the same escape). Renders just the button; the failure message is the
 * caller's to place, via `onState`.
 */
export function NewBoardButton({ onState }: NewBoardButtonProps = {}) {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const publish = (next: HomePageState): void => {
    setState(next);
    onState?.(next);
  };

  const create = async (): Promise<void> => {
    publish({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      // Navigating away: no further state to keep. Reset so a return is idle.
      setState({ kind: 'idle' });
      onState?.({ kind: 'idle' });
      navigate(`/b/${result.id}`);
      return;
    }
    publish({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
  };

  const creating = state.kind === 'creating';
  return (
    <button
      type="button"
      className="new-board-button"
      onClick={create}
      disabled={creating}
      data-testid="new-board-button"
    >
      {creating ? 'Creating…' : 'New board'}
    </button>
  );
}

/** The home page: product name, tagline, New board, and room for its error. */
export function HomePage() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  return (
    <main className="home-page" data-testid="home-page">
      <h1 className="home-brand">vidi6</h1>
      <p className="home-tagline">{HOME_TAGLINE}</p>
      <NewBoardButton onState={setState} />
      {state.kind === 'create_failed' && (
        <p className="home-error" role="alert" data-testid="home-error">
          {state.message}
        </p>
      )}
    </main>
  );
}
