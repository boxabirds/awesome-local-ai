import { BoardApp, canEdit } from './board/BoardApp';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

// Re-exported so the board UI keeps its original entry point.
export { BoardApp, canEdit };

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home': return <HomePage />;
    case 'board': return <BoardPage key={route.id} id={route.id} />;
    default: return <NotFoundPage />;
  }
}
