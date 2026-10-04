/**
 * Top-level app: renders the router which selects Home, Board, or NotFound.
 */
import { type JSX } from 'react';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import type { ConnectionState } from './sync/connectBoard';

/**
 * Whether the board is editable in the given connection state.
 * Only `load_failed` disables editing.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export default function App(): JSX.Element {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
