/**
 * Top-level app (story 5).
 *
 * Renders the router: Home page at `/`, Board page at `/b/:id`,
 * NotFound page for anything else.
 */
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
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
