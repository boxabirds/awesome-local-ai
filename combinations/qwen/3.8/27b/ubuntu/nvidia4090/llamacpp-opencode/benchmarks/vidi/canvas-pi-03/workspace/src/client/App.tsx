import { useEffect } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { initGlobalTestHooks } from './canvas/testHooks';

/**
 * The app shell (story 5, share.urls): a tiny history-based router.
 *
 *   /            -> HomePage   ("Create a board")
 *   /b/:boardId  -> BoardPage  (existence check, then the board UI)
 *   anything else-> NotFoundPage
 *
 * Story 2's "first visit lands on a fresh board" redirect is gone: the home
 * page owns creation, and unknown/malformed ids land on the not-found page
 * (which offers to create a new board).
 */
export function App() {
  const route = useRoute();

  useEffect(() => {
    initGlobalTestHooks();
  }, []);

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // key: remount (and re-check) when navigating between boards.
      return <BoardPage id={route.id} key={route.id} />;
    default:
      return <NotFoundPage />;
  }
}
