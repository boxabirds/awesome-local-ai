import { useCreateBoard } from './useCreateBoard';

/** The New board button with room for the creation error beneath it. */
export function NewBoardButton() {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <div className="new-board">
      <button
        type="button"
        className="primary-button"
        onClick={create}
        disabled={creating}
        aria-busy={creating || undefined}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p className="page-error" role="alert">
        {state.kind === 'create_failed' ? state.message : ''}
      </p>
    </div>
  );
}
