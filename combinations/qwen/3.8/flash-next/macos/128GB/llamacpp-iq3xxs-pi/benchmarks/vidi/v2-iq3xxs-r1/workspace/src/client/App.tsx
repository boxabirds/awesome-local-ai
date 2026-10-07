import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Which page the address asks for, and nothing else.
 *
 * Until story 3 this app had one page and no addresses. Story 3 gave a board its
 * address and let the browser fill one in when the address bar had none; that was a
 * trade the app could make while every board was private to one browser. Once a link
 * is the only way in, filling in an address is a claim about someone else's board, and
 * only the server can answer that.
 */
export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // `BoardPage` checks the link before it renders a board, so it — and not the
      // router — decides between a board, "Board not found", and a retry.
      return <BoardPage boardId={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
