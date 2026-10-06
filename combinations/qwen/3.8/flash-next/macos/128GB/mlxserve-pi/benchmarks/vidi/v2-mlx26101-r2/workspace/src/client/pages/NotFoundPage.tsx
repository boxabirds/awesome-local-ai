/**
 * The Board not found page (PRD `share.not_found`).
 *
 * What a person holding a broken link needs is not a stack of possibilities — "the link
 * may be mistyped, truncated, or from a board that was deleted" is a paragraph nobody
 * reads — it is one clear statement and two ways forward: check the link, or start a
 * board of their own. So this page has a heading, one line of text, a **New board**
 * button and a way back to the home page, and no diagnosis.
 *
 * The important thing about this page is what it does *not* do: it never creates a board
 * by being opened. A mistyped address is a place with nothing at it, and silently making
 * a board there would turn a typo into a board, and a shared link into a lottery. Only
 * pressing the button makes one, which is why the button is the same action the home
 * page's button is (`useCreateBoard`), and not this page's own idea of one.
 */

import type { JSX } from 'react';

import type { BoardsApi } from '../api.js';
import { HOME_PATH, navigate } from '../router.js';
import { NOT_FOUND_HEADING, NOT_FOUND_TEXT } from './state.js';
import { useCreateBoard } from './useCreateBoard.js';

export interface NotFoundPageProps {
  /** The board API, for the **New board** button. */
  api?: BoardsApi;
}

export function NotFoundPage({ api }: NotFoundPageProps): JSX.Element {
  const { state, create } = useCreateBoard(api);

  return (
    <main className="page not-found-page" data-testid="not-found-page">
      <p className="page-brand">vidi6</p>
      <h1 className="page-heading" data-testid="not-found-heading">
        {NOT_FOUND_HEADING}
      </h1>
      <p className="page-text" data-testid="not-found-text">
        {NOT_FOUND_TEXT}
      </p>

      <button
        type="button"
        className="page-button"
        data-testid="new-board-button"
        onClick={create}
        disabled={state.kind === 'creating'}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>

      {/* The message space belongs to the page rather than to the failure, so that a
          creation that went wrong does not move the button under the pointer. */}
      <p
        className="page-message"
        data-testid="home-message"
        role={state.kind === 'create_failed' ? 'alert' : undefined}
      >
        {state.kind === 'create_failed' ? state.message : ''}
      </p>

      <a
        className="page-link"
        data-testid="home-link"
        href={HOME_PATH}
        onClick={(event) => {
          // The same app, so the address bar does the work a page load would do.
          event.preventDefault();
          navigate(HOME_PATH);
        }}
      >
        Go to the vidi6 home page
      </a>
    </main>
  );
}
