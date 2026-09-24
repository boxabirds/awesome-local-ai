/**
 * Story 5 · the "Board not found" page (PRD share.not_found).
 *
 * This page exists because a mistyped link used to look like an empty board: a
 * visitor would start adding notes to a place nobody else was looking at. So it
 * says plainly that the address is the problem, and offers the way out — create
 * a new board (the same create action as home, PRD share.create_failure shares
 * its behaviour) or go back home.
 *
 * Nothing here creates a board at the broken address; the create button starts a
 * *new* board and navigates to its own address.
 */
import { useCreateBoard } from './useCreateBoard';
import { navigate } from '../router';

export const NOT_FOUND_TITLE = 'Board not found';
export const NOT_FOUND_BODY =
  'Check the link, or ask the person who shared it to send it again.';
export const CREATE_NEW_LABEL = 'Create a new board';
export const HOME_LINK_LABEL = 'Back to the home page';

export function NotFoundPage() {
  const { state, create } = useCreateBoard();

  return (
    <div className="page-stack" data-testid="not-found-page">
      <h1 className="page-title" data-testid="not-found-title">
        {NOT_FOUND_TITLE}
      </h1>
      <p className="page-tagline">{NOT_FOUND_BODY}</p>
      <button
        type="button"
        className="primary-action"
        data-testid="create-board"
        disabled={state === 'creating'}
        onClick={create}
      >
        {state === 'creating' ? 'Creating…' : CREATE_NEW_LABEL}
      </button>
      <button
        type="button"
        className="link-action"
        data-testid="home-link"
        onClick={() => navigate('/')}
      >
        {HOME_LINK_LABEL}
      </button>
    </div>
  );
}
