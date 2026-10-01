import { useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { boardPath } from '../../shared/routes';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/**
 * The Home page (share.create): the product's name, its one-line description and
 * a prominent New board button. Clicking it asks the server for a board; while
 * that is in hand the button reads "Creating…" and is disabled; on success it
 * navigates to the new board; on failure the person stays here and is told, in
 * the space under the button, that it could not be done and to try again
 * (share.create, share.create_failure).
 *
 * It is also what the Board-not-found page offers as its "New board" action —
 * creating a board is the same from either page, and neither ever creates one at
 * an address the person mistyped (share.not_found).
 */
export function HomePage(): JSX.Element {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const create = async (): Promise<void> => {
    if (state.kind === 'creating') return;
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(boardPath(result.id));
      return;
    }
    setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
  };

  const creating = state.kind === 'creating';

  return (
    <div className="home">
      <div className="home-card">
        <h1 className="home-title">vidi6</h1>
        <p className="home-tagline">A shared board for thinking together</p>
        <button
          type="button"
          className="home-new-board"
          onClick={() => {
            void create();
          }}
          disabled={creating}
          aria-busy={creating}
        >
          {creating ? 'Creating\u2026' : 'New board'}
        </button>
        <div className="home-error" role="alert">
          {state.kind === 'create_failed' ? state.message : ''}
        </div>
      </div>
    </div>
  );
}
