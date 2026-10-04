/**
 * The Board not found page (story 5, `share.not_found`).
 *
 * Shown for a link whose code is not a valid id or does not belong to an existing
 * board — a typo, a truncation, something made up. It creates nothing at that
 * address; it explains, offers New board (the same create action as home), and a
 * way back to the home page.
 */

import { NewBoardButton } from './HomePage';

export const NOT_FOUND_HEADING = 'Board not found';
export const NOT_FOUND_TEXT =
  'Check the link, or ask the person who shared it to send it again.';

export function NotFoundPage() {
  return (
    <main className="not-found-page" data-testid="not-found-page">
      <h1 data-testid="not-found-heading" className="not-found-heading">{NOT_FOUND_HEADING}</h1>
      <p className="not-found-text" data-testid="not-found-text">
        {NOT_FOUND_TEXT}
      </p>
      <NewBoardButton />
      <a className="not-found-home" href="/" data-testid="not-found-home">
        vidi6 home
      </a>
    </main>
  );
}
