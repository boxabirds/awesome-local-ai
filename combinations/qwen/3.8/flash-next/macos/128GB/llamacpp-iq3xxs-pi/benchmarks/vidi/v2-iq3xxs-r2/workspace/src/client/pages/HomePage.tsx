import { useCallback, useReducer, type JSX } from 'react';
import { createBoardRequest } from '../api';
import { boardPath, navigate } from '../router';
import { INITIAL_HOME_PAGE_STATE, nextHomePageState, type HomePageState } from './state';

/** Exact UI text (PRD: home page, `share.create`, `share.create_failure`). */
export const APP_NAME = 'vidi6';
export const TAGLINE = 'A shared board for thinking together';
export const NEW_BOARD_LABEL = 'New board';
export const CREATING_LABEL = 'Creating…';
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/**
 * The New board action, so the Board not found page can offer the same thing the home
 * page does with one button of its own (`share.not_found`: the way out of a bad link is
 * a good board).
 *
 * Creating happens on the server (`POST /api/boards`); this only asks, waits, and moves
 * to the board's address when the answer is a 201. If the answer is anything else the
 * person stays where they are, the button works again, and the message below explains it
 * (`share.create_failure`) — the request is not retried by the page, because a person
 * who wants to try again will press the button, and pressing it is what they expect to
 * be the thing that tries.
 */
export function useCreateBoard(): {
  readonly state: HomePageState;
  readonly create: () => void;
} {
  const [state, dispatch] = useReducer(nextHomePageState, INITIAL_HOME_PAGE_STATE);

  const create = useCallback((): void => {
    dispatch({ type: 'create-started' });
    void (async (): Promise<void> => {
      const created = await createBoardRequest();
      if (created.ok) {
        dispatch({ type: 'created' });
        navigate(boardPath(created.id));
        return;
      }
      dispatch({ type: 'create-failed' });
    })();
  }, []);

  return { state, create };
}

/** The label the button carries while it works, and whether it can be pressed again. */
export function newBoardButtonLabel(state: HomePageState): string {
  return state.stage === 'creating' ? CREATING_LABEL : NEW_BOARD_LABEL;
}

/**
 * The home page: the product name, one sentence, and New board (`share.create`). This is
 * the only way to start a board now — opening an address no longer makes one, which is
 * the difference story 5 exists to make.
 */
export function HomePage(): JSX.Element {
  const { state, create } = useCreateBoard();
  return (
    <main className="vidi6-page" data-testid="home">
      <h1 className="vidi6-brand">{APP_NAME}</h1>
      <p className="vidi6-tagline">{TAGLINE}</p>
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
    </main>
  );
}
