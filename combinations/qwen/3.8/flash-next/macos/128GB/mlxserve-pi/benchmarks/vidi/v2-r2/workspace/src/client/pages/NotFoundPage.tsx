// Board not found: the page a link lands on when no board answers to it.
//
// This page is the whole point of the story. Before it, a mistyped link opened an
// empty board, and an empty board looks exactly like a board somebody wiped - so a
// person following a truncated link would start working on a board that nothing else
// would ever see, while their colleagues worked somewhere else.
//
// Two things this page must not do:
//   - create a board by being opened (the server refuses that too: asking whether a
//     board exists writes nothing);
//   - claim the board was deleted, moved or never sent. We do not know which, and
//     the difference matters to the person reading it, so the page says what to do
//     rather than what happened.
//
// It offers the same New board action as the home page - the same hook, so the copy
// and the failure message cannot drift apart - and a way back.

import type { JSX } from 'react';
import { useCreateBoard } from './HomePage';
import { CREATE_FAILED_MESSAGE } from './state';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <main className="notice-page" data-testid="not-found-page">
      <div className="notice-card">
        <h1 className="notice-title" data-testid="not-found-heading">
          Board not found
        </h1>
        <p className="notice-line" data-testid="not-found-detail">
          Check the link, or ask the person who shared it to send it again.
        </p>
        <button
          type="button"
          className="notice-button"
          data-testid="not-found-new-board"
          onClick={create}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'New board'}
        </button>
        <p className="notice-under" data-testid="not-found-under" role={creating ? 'status' : undefined}>
          {state.kind === 'create_failed' ? CREATE_FAILED_MESSAGE : ''}
        </p>
        {/* A real link, so it can be opened in a new tab or copied like one. */}
        <a className="notice-back" data-testid="not-found-home" href="/">
          Back to the home page
        </a>
      </div>
    </main>
  );
}
