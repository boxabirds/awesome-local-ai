import type { JSX } from 'react';

import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

/**
 * The whole app: one route in, one page out.
 *
 * There is no board in here, and no notion of a board id — the router decides what
 * the address is, and each page knows only what it is. That is the whole of story
 * 5's front end: two page styles, one of which asks a question about an address
 * before it opens anything.
 */
export function App(): JSX.Element {
  const route = useRoute();
  switch (route.kind) {
    case 'home':
      return <HomePage />;
    case 'board':
      // Keyed by the id, so a link to another board replaces this page instead of
      // reopening it inside itself: two boards are never open at once.
      return <BoardPage key={route.boardId} boardId={route.boardId} />;
    case 'notFound':
      return <NotFoundPage path={route.path} />;
  }
}
