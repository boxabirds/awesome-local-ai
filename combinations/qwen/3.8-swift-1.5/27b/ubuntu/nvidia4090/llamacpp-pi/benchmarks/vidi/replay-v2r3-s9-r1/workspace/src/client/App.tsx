import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Story 5: the app is a thin router. `/` → home, `/b/:id` → board
 * (with existence check), anything else → board not found.
 */
export function App() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  // Keyed by board id: switching boards remounts the page, which destroys
  // the per-board undo controller (story 8: history is per board, per session).
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}
