// Top-level route switch (story 5, spec: share.pages):
//   /          → HomePage (Create a board)
//   /b/:id     → BoardPage (existence check → board / not found / unreachable)
//   anything   → NotFoundPage

import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}
