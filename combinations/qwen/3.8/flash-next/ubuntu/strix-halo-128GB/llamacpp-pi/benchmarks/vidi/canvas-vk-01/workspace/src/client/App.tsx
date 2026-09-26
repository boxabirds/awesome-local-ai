import { type JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Re-exports for tests and other consumers. */
export { BoardApp, BoardOverlays } from './BoardApp';

/**
 * The application shell: renders the page for the current route.
 */
export default function App(): JSX.Element {
  const route = useRoute();

  if (route.name === 'home') {
    return <HomePage />;
  }
  if (route.name === 'board') {
    return <BoardPage id={route.id} />;
  }
  return <NotFoundPage />;
}
