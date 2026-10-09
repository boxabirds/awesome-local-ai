import type { JSX } from 'react';
import { HOME_PATH } from '../router';
import { CREATE_FAILED_MESSAGE, newBoardButtonLabel, useCreateBoard } from './HomePage';

/** Exact UI text (PRD: `share.not_found`). */
export const NOT_FOUND_HEADING = 'Board not found';
export const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';
export const HOME_LINK_LABEL = 'Back to home';

/**
 * Board not found: shown for a link whose code is not a board's (`share.not_found`),
 * whether the code is badly formed, truncated, or simply never existed — the three of
 * them look identical here, on purpose, because the answer a person needs is the same and
 * the server keeps the difference to itself so that nothing about other people's boards
 * leaks.
 *
 * The New board button is the same action the home page has, which is what makes this
 * page a dead end that isn't: nothing was created at this address, and the way forward is
 * a board that is.
 */
export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();
  return (
    <main className="vidi6-page" data-testid="not-found">
      <h1 className="vidi6-brand">{NOT_FOUND_HEADING}</h1>
      <p className="vidi6-tagline">{NOT_FOUND_TEXT}</p>
      <button
        type="button"
        className="vidi6-primary-button"
        data-testid="new-board"
        onClick={create}
        disabled={state.stage === 'creating'}
      >
        {newBoardButtonLabel(state)}
      </button>
      {state.stage === 'create_failed' && (
        <p className="vidi6-form-message" role="alert" data-testid="create-error">
          {CREATE_FAILED_MESSAGE}
        </p>
      )}
      <a className="vidi6-home-link" data-testid="home-link" href={HOME_PATH}>
        {HOME_LINK_LABEL}
      </a>
    </main>
  );
}
