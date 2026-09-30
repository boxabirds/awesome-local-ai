import type { ReactNode } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * The whole application: a router over three addresses. `/` is home, `/b/<id>`
 * is a board, anything else is not found (router.ts). The board an address points
 * at is not opened until the app knows the board exists — the story 3 habit of
 * inventing a board in the browser is gone, because a mistyped link must show
 * Board not found and create nothing (share.not_found).
 */
export function App(): ReactNode {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // `key` remounts the page when the address changes, so navigating between
      // board links starts a fresh existence check and a fresh connection rather
      // than reusing the previous board's document and socket.
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
