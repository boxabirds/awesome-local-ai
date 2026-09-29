/**
 * Story 5 · the home page (PRD "Home page", share.create).
 *
 * Three things, deliberately: the product name, one sentence, and the Create a
 * board button. The button's label and disabled state *are* the `creating`
 * state, and the line beneath it is the only place failure and rate-limiting
 * surface (design "Home page" diagram). Both error states leave the visitor on
 * `/` with the button live again — the story is explicit that a failed create
 * must not look like a board (PRD share.create_failure).
 */
import { useCreateBoard } from './useCreateBoard';

export const CREATE_BUTTON_LABEL = 'Create a board';
export const CREATE_BUSY_LABEL = 'Creating…';
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";
export const RATE_LIMIT_MESSAGE =
  "You're creating boards too quickly. Wait a minute and try again.";
export const HOME_TAGLINE = 'A shared board for thinking together';

/** The message the home page shows for a create state (`null` for none). */
export function createMessage(state: 'idle' | 'creating' | 'failed' | 'rate_limited'): string {
  if (state === 'rate_limited') return RATE_LIMIT_MESSAGE;
  if (state === 'failed') return CREATE_FAILED_MESSAGE;
  return '';
}

export function HomePage() {
  const { state, create } = useCreateBoard();

  return (
    <div className="page-stack" data-testid="home-page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-tagline">{HOME_TAGLINE}</p>
      <button
        type="button"
        className="primary-action"
        data-testid="create-board"
        disabled={state === 'creating'}
        onClick={create}
      >
        {state === 'creating' ? CREATE_BUSY_LABEL : CREATE_BUTTON_LABEL}
      </button>
      {createMessage(state) !== '' && (
        <p className="page-message" role="alert" data-testid="create-message">
          {createMessage(state)}
        </p>
      )}
    </div>
  );
}
