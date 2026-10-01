// Which page the address asks for, and nothing else.
//
// Story 3 had this file invent a board id on `/` and rewrite the address bar to it.
// That is the behaviour this story exists to remove: an address can only name a board
// the service created, so `/` is a page that offers to make one, `/b/<id>` asks
// whether that board is there, and any other address says plainly that nothing lives
// at it. The decision itself is `routeFor()` (./router.ts); the pages hold their own
// states.
//
// A document can still be handed in from outside, which is how the component tests
// render the board without a network: it is the board alone, with no address to
// check and no link to share.

import type { JSX } from 'react';
import type * as Y from 'yjs';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage, BoardScreen } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export interface AppProps {
  /**
   * A document to render instead of a board the address names, bypassing the URL
   * routing and the network entirely. Tests use it to hold the same document the app
   * mutates; without it the app is driven by the address it is at.
   */
  doc?: Y.Doc;
}

export default function App(props: AppProps): JSX.Element {
  if (props.doc !== undefined) return <BoardScreen doc={props.doc} />;
  return <Router />;
}

/** The page for the current address. */
function Router(): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // The id may be malformed; `BoardPage` is the one that says what that means,
      // because it is the same thing the service would have said.
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
