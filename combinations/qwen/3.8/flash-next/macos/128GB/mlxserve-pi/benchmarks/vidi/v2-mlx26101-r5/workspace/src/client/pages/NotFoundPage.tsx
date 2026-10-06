/**
 * The page for a link that leads nowhere.
 *
 * Two jobs, and the second one is the reason this page exists at all. It says, in words, that
 * there is no board here — and it says it *instead of* opening an empty board, which is the
 * failure the PRD was written about: a person who follows a truncated link and gets a blank
 * canvas has no way to know they are wrong, so they start typing into the wrong place while
 * everybody else works somewhere else.
 *
 * The link that was asked for is shown back, because that is how a mistyped link gets fixed:
 * compared against the one that was sent, not remembered. And there is a way out in both
 * directions — a board of your own, or the home page that explains what this is.
 *
 * `share.not_found` also says a board is not created at the link, and this page keeps its half
 * of that: it asks for a board only when the person presses the button, and the board that comes
 * back has its own link, not this one.
 */

import { navigate } from '../router';
import {
  CREATE_FAILED_MESSAGE,
  CREATING_LABEL,
  HOME_LINK_LABEL,
  NEW_BOARD_LABEL,
  NOT_FOUND_DETAIL,
  NOT_FOUND_ASKED,
  NOT_FOUND_HEADING,
} from './messages';
import type { GoTo } from './useCreateBoard';
import { useCreateBoard } from './useCreateBoard';

export interface NotFoundPageProps {
  /** What the address asked for, when it looked like a board id. */
  boardId?: string | null;
  /** Where to go when a board arrives. Defaults to the router. */
  go?: GoTo;
}

/** Board not found. */
export function NotFoundPage({ boardId = null, go }: NotFoundPageProps): React.JSX.Element {
  const { state, start } = useCreateBoard(go ?? navigate);

  return (
    <main className="page" data-testid="not-found">
      <h1 className="page-title" data-testid="not-found-heading">
        {NOT_FOUND_HEADING}
      </h1>
      <p className="page-detail">{NOT_FOUND_DETAIL}</p>
      {boardId === null ? null : (
        <p className="page-asked-for">
          <span>{`${NOT_FOUND_ASKED} `}</span>
          {/* The address as it arrived, in a box that can be selected: the comparison a person
              makes with the link they were sent happens here, not in their head. */}
          <code data-testid="not-found-board-id">{boardId}</code>
        </p>
      )}
      <button
        type="button"
        className="page-button home-new-board"
        data-testid="new-board-button"
        disabled={state === 'creating'}
        onClick={start}
      >
        {state === 'creating' ? CREATING_LABEL : NEW_BOARD_LABEL}
      </button>
      {/* The same sentence the home page says, for the same reason: the way out of a dead link is
          a live one, and if *that* request fails too it has to be said here as well as anywhere. */}
      <p
        className="page-error"
        data-testid="not-found-error"
        role="status"
      >
        {state === 'failed' ? CREATE_FAILED_MESSAGE : ''}
      </p>
      {/* A real `href`, so the way back works with a middle click, with JavaScript broken, and
          with the keyboard. */}
      <a className="home-link" data-testid="home-link" href="/">
        {HOME_LINK_LABEL}
      </a>
    </main>
  );
}
