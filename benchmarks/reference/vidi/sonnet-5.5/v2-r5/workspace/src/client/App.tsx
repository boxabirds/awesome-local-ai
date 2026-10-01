import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home': return <HomePage />;
    case 'board': return <BoardPage id={route.id} />;
    case 'not_found': return <NotFoundPage />;
  }
}
