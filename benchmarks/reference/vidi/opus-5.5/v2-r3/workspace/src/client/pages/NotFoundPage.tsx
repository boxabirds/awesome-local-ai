// Board not found (share.not_found): nothing is created at the unknown address.
import type { MouseEvent } from 'react';
import { navigate } from '../router';
import { NewBoardButton } from './NewBoardButton';
import { useCreateBoard } from './useCreateBoard';

export function NotFoundPage() {
  const { state, create } = useCreateBoard();
  const goHome = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate('/');
  };
  return (
    <main className="page not-found-page">
      <h1 className="page-title">Board not found</h1>
      <p className="page-lead">Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton state={state} onCreate={create} />
      <a className="page-link" href="/" onClick={goHome}>
        Go to the vidi6 home page
      </a>
    </main>
  );
}
