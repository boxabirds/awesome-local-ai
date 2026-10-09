import type { JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Story 5 routing: '/' is Home (create a board), '/b/<id>' is a board whose
// existence is checked before the stories 1–4 UI mounts, and anything else is
// Board not found. The story 3 implicit-mint behaviour is gone — boards are
// only created through the API.
export function App(): JSX.Element {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}
