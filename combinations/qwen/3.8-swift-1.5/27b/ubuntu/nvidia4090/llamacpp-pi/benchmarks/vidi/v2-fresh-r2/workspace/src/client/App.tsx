/**
 * App: renders the current route (story 5).
 *
 * - `/` → Home page (New board)
 * - `/b/:id` → Board page (existence check → board / not found / unreachable)
 * - anything else → Board not found page
 *
 * The story 3 redirect from `/` to a client-generated id is gone: boards
 * are created server-side via POST /api/boards.
 */
import type { JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App(): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // key by id: a fresh BoardPage (and fresh existence-check state) per
      // board, so a `not_found` state never carries over when the id changes
      // (e.g. New board from the not-found page).
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
