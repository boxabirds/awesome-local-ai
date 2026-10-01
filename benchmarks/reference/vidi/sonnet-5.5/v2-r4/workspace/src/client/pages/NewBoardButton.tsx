import { primaryButtonStyle, useCreateBoard } from './useCreateBoard';

/** New board button with its "Creating…" state and the failure message beneath it. */
export function NewBoardButton() {
  const { state, create } = useCreateBoard();
  const creating = state.kind === 'creating';
  return (
    <>
      <button type="button" onClick={create} disabled={creating} style={{ ...primaryButtonStyle, opacity: creating ? 0.7 : 1 }}>
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p role="alert" style={{ margin: 0, minHeight: 20, color: '#C62828', font: '14px system-ui, sans-serif' }}>
        {state.kind === 'create_failed' ? state.message : ''}
      </p>
    </>
  );
}
