// Board not found: shown for unknown codes, malformed codes and dead links.
// Nothing is created by *opening* the link; the Create a new board button reuses
// HomePage's create action, which creates a board at a brand-new address.

import type { MouseEvent } from 'react';
import { navigate } from '../router';
import {
  ERROR_CREATE_MESSAGE,
  ERROR_RATE_LIMIT_MESSAGE,
  useCreateBoardAction,
} from './HomePage';

function HomeLink() {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate('/');
  };
  return (
    <a className="home-link" href="/" onClick={onClick}>
      Back to vidi6
    </a>
  );
}

export function NotFoundPage() {
  const { phase, create } = useCreateBoardAction();
  const creating = phase === 'creating';
  return (
    <main className="page not-found-page">
      <div className="not-found-card">
        <h1 className="not-found-heading">Board not found</h1>
        <p className="not-found-body">Check the link, or ask the person who shared it to send it again.</p>
        <button
          type="button"
          className="create-board-button"
          disabled={creating}
          aria-busy={creating}
          onClick={() => void create()}
        >
          {creating ? 'Creating…' : 'Create a new board'}
        </button>
        <p className="not-found-home">
          <HomeLink />
        </p>
        {phase === 'failed' ? (
          <p className="home-error" role="alert">
            {ERROR_CREATE_MESSAGE}
          </p>
        ) : null}
        {phase === 'rate_limited' ? (
          <p className="home-error" role="alert">
            {ERROR_RATE_LIMIT_MESSAGE}
          </p>
        ) : null}
      </div>
    </main>
  );
}
