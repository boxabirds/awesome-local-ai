import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Story 5: the app is now a router.
 *   /        → HomePage (New board)
 *   /b/:id   → BoardPage (existence check → Board + SharePanel)
 *   other    → NotFoundPage
 */
export default function App() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}
