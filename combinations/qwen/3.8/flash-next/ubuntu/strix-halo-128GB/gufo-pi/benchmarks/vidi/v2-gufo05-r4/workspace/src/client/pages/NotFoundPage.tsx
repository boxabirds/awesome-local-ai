/**
 * The end of the line for an address (`share.not_found`).
 *
 * One page for two different reasons — a link that was never a board, and a link whose code
 * is nonsense — because from the other side of a message they are the same experience:
 * nobody is in here. Telling them apart would hand a stranger a way to probe which addresses
 * have been handed out.
 *
 * The New board button is the point of this page. A person who followed a broken link has
 * already decided they want a board, and the alternative — leaving them at a dead end with
 * their work somewhere else — is what the PRD calls "the blank board" problem.
 */

import { type JSX } from 'react';
import { navigate } from '../router';
import { useNewBoard } from './HomePage';

export function NotFoundPage(): JSX.Element {
  const { state, newBoard } = useNewBoard();
  const creating = state.kind === 'creating';

  return (
    <div className="vidi6-page vidi6-page--not-found">
      <main className="vidi6-not-found">
        <h1>Board not found</h1>
        <p className="vidi6-not-found__detail">
          Check the link, or ask the person who shared it to send it again.
        </p>
        <button
          type="button"
          className="vidi6-button vidi6-button--primary"
          onClick={newBoard}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'New board'}
        </button>
        <p className="vidi6-home__message" role="status">
          {state.kind === 'create_failed' ? state.message : ''}
        </p>
        <a
          className="vidi6-not-found__home"
          href="/"
          onClick={(event) => {
            // A real `href` so the link can be copied or opened elsewhere; in this tab it
            // is a route change rather than a reload.
            event.preventDefault();
            navigate('/');
          }}
        >
          Back to vidi6
        </a>
      </main>
    </div>
  );
}
