// The app shell: an address, and the page that belongs to it.
//
//   /            Home  — the product name and the only New board button
//   /b/<link>    Board — checks the link exists, then mounts the board
//   anything else Board not found
//
// Story 5 removed the story 3 behaviour where a bare `/` silently minted a board id
// in the address bar: a board is now created by an explicit action, so the address
// bar never quietly claims a board that was never created (share.board_api).

import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

export default function App() {
  const route = useRoute();
  if (route.name === 'board') return <BoardPage id={route.id} />;
  if (route.name === 'home') return <HomePage />;
  return <NotFoundPage />;
}
