import type { MouseEvent } from 'react';
import { navigate } from '../router';
import { NewBoardButton } from './NewBoardButton';

export function NotFoundPage() {
  const goHome = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate('/');
  };
  return (
    <main className="page">
      <h1 className="page-title">Board not found</h1>
      <p className="page-text">Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton />
      <a className="page-link" href="/" onClick={goHome}>
        Go to the home page
      </a>
    </main>
  );
}
