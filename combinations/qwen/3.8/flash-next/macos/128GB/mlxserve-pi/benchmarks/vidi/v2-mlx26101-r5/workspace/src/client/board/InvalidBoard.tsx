/** What the screen says when the address names something that is not a board. */
export const INVALID_BOARD_MESSAGE = 'This link is not a valid board.';

export interface InvalidBoardProps {
  /** The part of the address that was supposed to be a board id. */
  boardId: string;
  /** Gives up on this address and opens a board that works. */
  onNewBoard(): void;
}

/**
 * Shown in place of the board when the address is `/b/` followed by something that
 * cannot be a board id.
 *
 * Nothing is joined and nothing is created until the visitor asks: opening a board
 * behind somebody's back would leave them looking at an empty canvas while the link
 * they pasted is quietly lost.
 */
export function InvalidBoard({ boardId, onNewBoard }: InvalidBoardProps): React.JSX.Element {
  return (
    <div className="invalid-board" data-testid="invalid-board">
      <h1 className="invalid-board__message">{INVALID_BOARD_MESSAGE}</h1>
      <p className="invalid-board__detail">
        <code className="invalid-board__id" data-testid="invalid-board-id">
          {boardId}
        </code>{' '}
        is not a board id. Check the link, or start a board of your own.
      </p>
      <button
        type="button"
        className="invalid-board__new"
        data-testid="new-board-button"
        onClick={onNewBoard}
      >
        Create a new board
      </button>
    </div>
  );
}
