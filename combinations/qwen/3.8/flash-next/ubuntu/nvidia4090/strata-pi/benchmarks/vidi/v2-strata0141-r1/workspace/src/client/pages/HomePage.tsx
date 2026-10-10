import { useCallback, useState } from 'react';
import { BOARD_PATH_PREFIX } from '../../shared/config';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILURE_MESSAGE, homePageStateAfterCreate, nextHomePageState, type HomePageState } from './state';

/**
 * The home page (`share.create`).
 *
 * Its one action is New board: ask the server for a board, then show it. The
 * request is made once per click and the button is disabled while it is in
 * flight, so a impatient clicker cannot produce a pile of boards.
 */

export function HomePage() {
  return (
    <main className="page page--home" data-testid="home-page">
      <h1 className="page__title">vidi6</h1>
      <p className="page__lead">A shared board you can think on together.</p>
      <NewBoardButton />
    </main>
  );
}

/**
 * New board, on its own because the Board not found page offers it too
 * (`share.not_found`): someone holding a bad link still wants a board.
 */
export function NewBoardButton() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const create = useCallback(async () => {
    setState(nextHomePageState());
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      // The page that shows the board is the board's own address, so the link a
      // person can copy is already in the address bar (`share.copy_link`).
      navigate(`${BOARD_PATH_PREFIX}${result.id}`);
      return;
    }
    setState(homePageStateAfterCreate(result));
  }, []);

  return (
    <>
      <button
        type="button"
        className="page__primary"
        data-testid="new-board"
        disabled={state.kind === 'creating'}
        onClick={() => {
          void create();
        }}
      >
        {state.kind === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' ? (
        <p className="page__error" data-testid="create-error" role="alert">
          {CREATE_FAILURE_MESSAGE}
        </p>
      ) : null}
    </>
  );
}
