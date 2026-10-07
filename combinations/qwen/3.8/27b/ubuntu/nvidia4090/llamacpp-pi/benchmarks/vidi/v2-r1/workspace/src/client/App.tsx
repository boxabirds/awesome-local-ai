// App (story 5): the tiny pathname router over the three pages — home, board
// and not found. Story 3's redirect from / to a random board is gone: / is
// now the home page, and opening a board link goes straight to its board
// (share.open_link).

import type { JSX } from 'react';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Story 4 edit gate (kept here so existing imports work): editing is
 * disabled only while the board's storage could not be loaded. While
 * `reconnecting` (e.g. after a storage failure close 1011) the board stays
 * editable — unsaved changes are re-sent on reconnection.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function App(): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // key: remount BoardPage (fresh check state) when the id changes.
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
