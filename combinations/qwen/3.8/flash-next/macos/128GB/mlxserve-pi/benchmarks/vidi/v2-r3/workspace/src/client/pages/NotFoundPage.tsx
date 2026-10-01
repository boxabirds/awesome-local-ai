import { useState, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { boardPath } from '../../shared/routes';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/**
 * The Board not found page (share.not_found): shown for a link whose code names
 * no board — a typo, a truncated link, a made-up address. It says so plainly and
 * offers a way forward (make a new board, or go home); it does NOT create a board
 * at this address, so mistyping a link never seeds a stray board.
 */
export function NotFoundPage(): JSX.Element {
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
        <h1 className="home-title">Board not found</h1>
        <p className="home-tagline">Check the link, or ask the person who shared it to send it again.</p>
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
        <p className="home-home-link">
          <a href="/">Back to home</a>
        </p>
      </div>
    </div>
  );
}
