// Which page the address asks for, and nothing else.
//
// The board grew a page of its own in story 5, so this is no longer the board - it
// is the thing that decides whether an address is the start page, a board, or
// nobody's board, and it renders one of those three. The route is read from the
// History API and re-read on `popstate`, so the back button returns to a board
// that is still there and a created board's address is the address in the bar
// rather than a state variable that only looks like one.
//
// `makeProvider` passes straight through to the board: the component suite drives a
// board whose collaboration it chooses, and this file has no opinion about that.
import BoardPage from './pages/BoardPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { routeKey, useRoute } from './useRoute.ts';
import type { ProviderFactory } from './collab/connectBoard.ts';

export interface AppProps {
  makeProvider?: ProviderFactory;
}

export default function App({ makeProvider }: AppProps) {
  const route = useRoute();

  // One thing about this key: it is the code, so a different code is a new page
  // with nothing left over from the board before it - not a check in flight, not a
  // copy message, not a document.
  switch (route.kind) {
    case 'home':
      return <HomePage />;
    case 'board':
      return (
        <BoardPage key={routeKey(route)} boardId={route.boardId} makeProvider={makeProvider} />
      );
    case 'not_found':
      // The page does not need the code it is missing: it says what to do about a
      // link that is nobody's board, and offers a board of the visitor's own.
      return <NotFoundPage />;
  }
}
