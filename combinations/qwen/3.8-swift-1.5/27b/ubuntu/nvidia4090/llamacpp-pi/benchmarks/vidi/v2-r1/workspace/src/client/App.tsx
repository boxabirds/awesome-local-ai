import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * App entry (story 5): renders the router. The story 3 redirect from `/` to a
 * client-generated board id is removed — boards are created server-side via
 * the home page's New board action.
 */
export function App() {
  const route = useRoute();

  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}
