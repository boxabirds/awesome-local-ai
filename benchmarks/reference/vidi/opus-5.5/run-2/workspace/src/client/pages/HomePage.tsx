/** Home page (anchor: share.pages): product name, one line, Create a board. */
import { CREATING_TEXT, useCreateBoard } from './useCreateBoard';

export const TAGLINE = 'A shared board for thinking together';

export function HomePage(): React.JSX.Element {
  const { creating, error, create } = useCreateBoard();
  return (
    <main className="page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-text">{TAGLINE}</p>
      <button type="button" className="primary-button" onClick={create} disabled={creating} aria-busy={creating}>
        {creating ? CREATING_TEXT : 'Create a board'}
      </button>
      <p className="page-error" role="alert">
        {error}
      </p>
    </main>
  );
}
