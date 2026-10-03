import type { JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * App: renders the router (story 5). `/` → Home (New board),
 * `/b/:id` → Board (existence check, then the stories 1–4 board),
 * anything else → Board not found.
 */
export function App(): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} />;
    default:
      return <NotFoundPage />;
  }
}
