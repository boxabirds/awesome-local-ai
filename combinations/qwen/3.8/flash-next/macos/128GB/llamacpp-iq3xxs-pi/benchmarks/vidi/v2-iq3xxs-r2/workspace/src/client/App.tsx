import type { JSX } from 'react';
import { useRoute } from './router';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * The app is three pages now, and the address bar says which one (`/`, `/b/:id`, and
 * anything else — story 5). There is no state in here: the address is the state, which is
 * what makes a board link a thing you can send somebody.
 *
 * Story 3's `/` redirect to a client-generated board id is gone. It existed so that
 * opening the app was always a board; now opening the app is the home page, and a board
 * begins when `POST /api/boards` says it does.
 */
export function App(): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'board':
      return <BoardPage boardId={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
    case 'home':
      return <HomePage />;
  }
}
