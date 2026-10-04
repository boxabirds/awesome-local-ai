/**
 * App root (story 5): renders the router. `/` → Home, `/b/:id` → Board page
 * (existence check, then the live board with the Share panel), anything
 * else → Board not found.
 */
import type { JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App(): JSX.Element {
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
