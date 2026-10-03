// "Board not found" (share.not_found): the one page for every link that does not
// lead to a board — an id that was never created, an id that is not a link at all, a
// pasted-with-a-bit-missing link, or a path this app has never heard of.
//
// All of those get the same short answer on purpose. Nothing here says *why* (never
// "malformed", never "expired", never "deleted"), because the service does not know
// and guessing would be a lie; and nothing leaks another board's link.
//
// Two ways forward: check the link the user was given, or start a new board.

import type { JSX } from 'react';
import { NewBoardButton } from './NewBoardButton';

export function NotFoundPage(): JSX.Element {
  return (
    <main className="status-screen not-found-page" data-testid="not-found-page">
      <div className="not-found-card">
        <h1 className="not-found-title">Board not found</h1>
        <p className="not-found-text">
          Check the link, or ask the person who shared it to send it again.
        </p>
        <NewBoardButton className="not-found-new-board" />
        <a className="not-found-home" href="/" data-testid="not-found-home">
          Back to vidi6
        </a>
      </div>
    </main>
  );
}
