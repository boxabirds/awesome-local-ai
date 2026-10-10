import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * The shell: which page the address names (`share.open_link`).
 *
 * `/` is the home page, `/b/<id>` is a board, and everything else is the Board
 * not found page. There is no other navigation in the app - a board is reached by
 * being created here or by being given a link, which is why the address bar is the
 * whole router.
 */
export function App() {
  const route = useRoute();

  if (route.name === 'home') {
    return <HomePage />;
  }
  if (route.name === 'board') {
    return <BoardPage boardId={route.id} />;
  }
  return <NotFoundPage />;
}
