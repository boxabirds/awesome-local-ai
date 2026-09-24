import type { MouseEvent } from 'react';
import { navigate } from '../router';
import { CreateBoardButton } from './HomePage';

export const NOT_FOUND_HEADING = 'Board not found';
export const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';

function goHome(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate('/');
}

/** Shown for unknown and malformed board links. Nothing is created at the address. */
export function NotFoundPage() {
  return (
    <main className="page page--not-found">
      <h1 className="page__title">{NOT_FOUND_HEADING}</h1>
      <p className="page__text">{NOT_FOUND_TEXT}</p>
      <CreateBoardButton label="Create a new board" />
      <a className="page__link" href="/" onClick={goHome}>
        Go to the home page
      </a>
    </main>
  );
}
