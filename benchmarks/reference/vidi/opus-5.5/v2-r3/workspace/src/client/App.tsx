// App: three routes (story 5). `/` Home, `/b/:id` a board, anything else Board not found.
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

export { canEdit } from './board/Board';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // Keyed so switching boards starts from a fresh existence check.
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
