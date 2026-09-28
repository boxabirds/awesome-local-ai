/**
 * Story 5: the app is the tiny pathname router (story 3's client-side
 * redirect from `/` to a random board id is gone — creation is server-side).
 *
 *   /          → HomePage (Create a board)
 *   /b/:id     → BoardPage (existence check → board / not found / unreachable)
 *   anything   → NotFoundPage
 */
import type { JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App(): JSX.Element {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}
