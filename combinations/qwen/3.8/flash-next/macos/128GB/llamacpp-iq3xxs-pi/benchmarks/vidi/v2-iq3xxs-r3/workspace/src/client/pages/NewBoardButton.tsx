import { useState } from 'react';
import type { JSX } from 'react';

import { createBoard } from '../api';
import { boardHref, navigate } from '../router';

/**
 * **New board**: ask the server for a board, and go to it.
 *
 * The button is the app's front door, and it is the only way a board comes to
 * exist — the client no longer invents addresses (share.board_api). A board that
 * could not be made is said, and the button is ready to be pressed again: a person
 * who clicks **New board** twice in a row gets either two boards or one board and
 * a message, never a spinner.
 *
 * Used by the home page and by the not-found page, so the way out of a bad link is
 * the way in.
 */
export function NewBoardButton({
  className = 'new-board',
}: {
  readonly className?: string;
} = {}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const makeBoard = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    const boardId = await createBoard();
    if (boardId === null) {
      // share.create_failure: said, and pressed again is allowed.
      setFailed(true);
      setBusy(false);
      return;
    }
    // The link is written by the router, not here, and the app is at the board
    // with one mount: no reload, and no stack of board pages in the back button.
    navigate(boardHref(boardId));
  };

  return (
    <>
      {failed && (
        <p className="new-board-error" role="alert" data-testid="new-board-error">
          Could not start a board. Check your connection and try again.
        </p>
      )}
      <button type="button" className={className} onClick={() => void makeBoard()} disabled={busy}>
        {busy ? 'Starting board…' : 'New board'}
      </button>
    </>
  );
}
