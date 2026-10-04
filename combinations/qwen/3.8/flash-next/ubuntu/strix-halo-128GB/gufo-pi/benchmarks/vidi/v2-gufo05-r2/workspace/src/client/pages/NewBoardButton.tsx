/**
 * The "New board" button, and the words that go with it when no board came
 * (share.create, share.create_failure).
 *
 * Both pages that offer a board render this, so the two cannot drift into saying
 * different things about the same failure.
 */

import { useCreateBoard } from './useCreateBoard';

export function NewBoardButton() {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';

  return (
    <div className="new-board">
      <button
        type="button"
        className="new-board-button"
        data-testid="new-board-button"
        onClick={create}
        // While a board is being made the button says so and does nothing else:
        // one click, one board.
        disabled={creating}
        aria-busy={creating}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {state.kind === 'create_failed' && (
        <p className="create-error" data-testid="create-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
