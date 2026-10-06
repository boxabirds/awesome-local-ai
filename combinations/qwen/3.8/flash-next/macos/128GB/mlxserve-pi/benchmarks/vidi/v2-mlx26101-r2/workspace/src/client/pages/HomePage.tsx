/**
 * The home page (PRD `share.create`).
 *
 * One button, and the shortest possible route from "I want to make a board" to a board:
 * product name, one line about what this is, **New board**. There is no board list, no
 * recent boards, no sign-in and nothing to explain first — story 6 owns the list, and
 * what story 5 owns is that one click on a page that loads instantly is enough to get
 * someone to a board they can share.
 *
 * Clicking the button creates the board *on the server*, which is the whole difference
 * between this and story 4: a board made here has an address that works for other people
 * before this browser has ever looked at it. The button is disabled while the creation is
 * on its way (a board per click, not per attempt), and if the service says no, the
 * failure appears under the button and the button comes back — because the only thing
 * more annoying than an error message is an error message on a screen where the thing you
 * pressed has disappeared.
 */

import type { JSX } from 'react';

import type { BoardsApi } from '../api.js';
import { useCreateBoard } from './useCreateBoard.js';

/** PRD `share.create`: the one sentence that says what vidi6 is. */
export const HOME_TAGLINE = 'A shared board for thinking together';

export interface HomePageProps {
  /** The board API, so a test can hand this page an answer. */
  api?: BoardsApi;
}

export function HomePage({ api }: HomePageProps): JSX.Element {
  const { state, create } = useCreateBoard(api);

  return (
    <main className="page home-page" data-testid="home-page">
      <h1 className="page-brand page-brand-home">vidi6</h1>
      <p className="page-text" data-testid="home-tagline">
        {HOME_TAGLINE}
      </p>

      <button
        type="button"
        className="page-button page-button-primary"
        data-testid="new-board-button"
        onClick={create}
        disabled={state.kind === 'creating'}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>

      {/* The message space is always in the layout — reserved, not inserted — so a
          failure that appears under the button does not move the button, which is the
          thing the person is about to press again. */}
      <p
        className="page-message"
        data-testid="home-message"
        role={state.kind === 'create_failed' ? 'alert' : undefined}
      >
        {state.kind === 'create_failed' ? state.message : ''}
      </p>
    </main>
  );
}
