import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

export function Root() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
