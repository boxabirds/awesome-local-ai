import { type JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage, type BoardPageProps } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export { canEdit } from './board/Board';

export type AppProps = Pick<BoardPageProps, 'onDocReady' | 'onProviderReady'>;

/**
 * The top-level page (share.pages). Story 3's client-side redirect from `/` to a
 * freshly generated board address is gone: `/` is now the Home page. The router
 * picks one of three pages from the address — the Home page, a board, or the
 * Board-not-found page — and the board page only comes into being once the
 * service says the board exists.
 */
export function App(props: AppProps = {}): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} onDocReady={props.onDocReady} onProviderReady={props.onProviderReady} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
