// Story 5: App is now the router shell — Home, Board and Board-not-found.
// The stories 1–4 board lives in pages/BoardScreen, mounted by BoardPage
// only after the board's existence check passes.

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
