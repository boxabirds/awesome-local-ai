import type { JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Which page this address is.
 *
 * Three pages, one address bar, and nothing in between: the home page, a board, and the page for
 * an address that is not a board. A board's id comes out of the address and is given to the page
 * as a key, which is how a tab that goes from one board to another builds a new document and a new
 * connection instead of carrying one board's notes into another board's room - the one mistake this
 * file could make, and the reason it is a file rather than a few lines in `main.tsx`.
 */
export function Root(): JSX.Element {
  const route = useRoute();
  switch (route.kind) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage key={route.boardId} boardId={route.boardId} />;
    case 'not-found':
      return <NotFoundPage />;
  }
}
