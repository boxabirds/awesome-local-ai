import type { HomePageState } from './state';

/** New board button with its "Creating…" state and the failure message beneath it. */
export function NewBoardButton({ state, onCreate }: { state: HomePageState; onCreate(): void }) {
  const creating = state.kind === 'creating';
  return (
    <div className="new-board">
      <button type="button" className="primary-button" onClick={onCreate} disabled={creating} aria-busy={creating}>
        {creating ? 'Creating…' : 'New board'}
      </button>
      <p className="page-error" role="alert">
        {state.kind === 'create_failed' ? state.message : ''}
      </p>
    </div>
  );
}
