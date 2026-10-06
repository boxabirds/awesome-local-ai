/**
 * Which page this tab is showing, and the page itself.
 *
 * Four addresses mean anything, and each has exactly one page:
 *
 *   `/`          the home page — what vidi6 is, and the way to a new board
 *   `/b/<id>`    a board, once the service has said it exists
 *   `/b/…`       anything else after `/b/`: Board not found
 *   `/anything`  Board not found as well
 *
 * The rule behind the last two is that we do not invent a page for an address we do not have,
 * and we do not invent a board either (`share.not_found`). Story 3 sent an unrecognised address
 * to a board of the visit's own making; that is the behaviour this story exists to remove, so it
 * is gone rather than kept as a fallback.
 *
 * A board is keyed by its id: moving to another board is a new board, with a new document and a
 * new connection — never the old board's notes wearing the new board's address.
 */

import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useNavigator } from './router';

export default function App(): React.JSX.Element {
  const { route, go } = useNavigator();

  switch (route.kind) {
    case 'home':
      return <HomePage go={go} />;
    case 'board':
      return <BoardPage key={route.boardId} boardId={route.boardId} go={go} />;
    case 'notFound':
      // Malformed link or unknown path: the same page, the same way out, and no request sent.
      return <NotFoundPage boardId={route.boardId} go={go} />;
  }
}
