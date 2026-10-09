import type { ReactElement } from 'react';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

/** Re-exported for the story 4 component tests (persist.client_status). */
export { canEdit } from './Board';

/**
 * App (story 5, share.routes): the pathname router. `/` is the home page,
 * `/b/:id` is the board page (existence check then the board), anything else
 * is the board-not-found page. The story 3 client redirect from `/` to a
 * random board id is gone: boards are created server-side now.
 */
export default function App(): ReactElement {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}
