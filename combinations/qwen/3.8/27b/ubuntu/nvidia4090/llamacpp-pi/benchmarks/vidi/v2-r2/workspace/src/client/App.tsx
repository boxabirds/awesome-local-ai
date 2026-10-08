/**
 * vidi6 client entry (story 5): the router.
 *
 * Routes: `/` → HomePage (New board), `/b/:id` → BoardPage (existence check,
 * then the board or the not-found page), anything else → not found.
 * Story 3's "unknown path → fresh client-side board" redirect is gone:
 * boards are created server-side and only ever live at their server-issued
 * link.
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
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
