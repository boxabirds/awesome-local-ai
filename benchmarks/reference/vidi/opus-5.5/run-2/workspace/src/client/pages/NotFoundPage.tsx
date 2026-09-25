/**
 * Board not found (anchor: share.pages): shown for unknown or malformed board links and any
 * other address. Nothing is ever created at the address that was opened.
 */
import type { MouseEvent } from 'react';
import { navigate } from '../router';
import { CREATING_TEXT, useCreateBoard } from './useCreateBoard';

export const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';

export function NotFoundPage(): React.JSX.Element {
  const { creating, error, create } = useCreateBoard();
  const goHome = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate('/');
  };
  return (
    <main className="page">
      <h1 className="page-title">Board not found</h1>
      <p className="page-text">{NOT_FOUND_TEXT}</p>
      <button type="button" className="primary-button" onClick={create} disabled={creating} aria-busy={creating}>
        {creating ? CREATING_TEXT : 'Create a new board'}
      </button>
      <p className="page-error" role="alert">
        {error}
      </p>
      <a className="page-link" href="/" onClick={goHome}>
        Go to the home page
      </a>
    </main>
  );
}
