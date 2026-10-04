/**
 * App: the address decides the page, and the page decides what to ask the server.
 *
 *   /            HomePage       make a board, and open it
 *   /b/<id>      BoardPage      find out whether it exists, then show it
 *   anything else  NotFoundPage  say so, and offer a board of your own
 *
 * This replaced story 3's "any address that names no board gets a fresh random one":
 * convenient while boards were only ever reached by an address this page invented, and
 * the first thing that had to go once links were shared — it turns a mistyped link into
 * a real, empty board, which looks distressingly like a board that was emptied. Now a
 * board comes to exist by asking (POST /api/boards), so this
 * page has nothing left to invent, and every address it does not recognise can be
 * answered with the truth (share.home_page, share.not_found).
 */

import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

/** Story 4's rule about what a broken board may not be edited into. */
export { canEdit } from './board/BoardSurface';

export default function App() {
  const route = useRoute();

  if (route.name === 'board') {
    // `key` keeps two boards from ever sharing a document: opening another board
    // tears this one down completely instead of re-pointing it.
    return <BoardPage key={route.id} boardId={route.id} />;
  }
  if (route.name === 'home') return <HomePage />;
  return <NotFoundPage />;
}
