/**
 * The app, which is to say: the address bar, and three pages.
 *
 * Until story 5 this file *was* the board. It isn't any more, and the difference is the
 * story: a board is now a place you go to rather than a thing you have, so the address has
 * to be able to say "that board" and "this board", and `/` had to stop inventing one. The
 * board itself is `board/BoardSurface.tsx` — unchanged, and still not knowing that any of
 * this happened — and what is left here is the thing that decides which of three things a
 * person is looking at:
 *
 *  - `/` is the home page, where a board is made by asking the server for one;
 *  - `/b/<id>` is a board, once someone has checked that it is one (that is the page's
 *    job, not this file's, and it is why a stale link shows a page instead of a spinner);
 *  - everything else is the Board not found page, which is a real page rather than a
 *    mistake, and which is the only answer this app gives to an address it doesn't know.
 *
 * There is no router library, because three routes do not justify a dependency, and the
 * browser already has a router in it — `history` and the `popstate` event, which is what
 * `router.ts` is a thin skin over.
 *
 * `connect` and `api` are the two seams: the room transport and the board API. Tests hand
 * this component a service that answers late, or not at all, which is the only way to
 * test a page that is waiting for a server without waiting for a server.
 */

import type { JSX } from 'react';

import type { BoardsApi } from './api.js';
import { boardsApi } from './api.js';
import type { BoardConnector } from './board/useBoardDoc.js';
import { useRoute } from './router.js';
import { BoardPage } from './pages/BoardPage.js';
import { HomePage } from './pages/HomePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export interface AppProps {
  /** How to reach the room; tests pass a fake (see `connectBoard`). */
  connect?: BoardConnector;
  /** The board API; tests pass one that answers, fails or says the board isn't there. */
  api?: BoardsApi;
}

export function App({ connect, api = boardsApi }: AppProps = {}): JSX.Element {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <HomePage api={api} />;
    case 'board':
      // Keyed by id, so going from one board link to another is a new page and not the old
      // one wearing a different hat: the new board is checked, the new board's socket is
      // opened, and none of the old board's state — notes, camera, retry count — survives.
      return <BoardPage key={route.id} id={route.id} api={api} connect={connect} />;
    case 'not_found':
      return <NotFoundPage api={api} />;
  }
}
