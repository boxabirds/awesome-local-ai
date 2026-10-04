/**
 * The application root (story 5): the router's one route, rendered.
 *
 * `useRoute` reads the address bar and re-renders on navigation; this just maps
 * the three routes to their pages. The board itself (`App`) is rendered only by
 * `BoardPage`, and only once the board is known to exist — so opening a bad link
 * never mounts a board.
 */

import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function Root() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}
