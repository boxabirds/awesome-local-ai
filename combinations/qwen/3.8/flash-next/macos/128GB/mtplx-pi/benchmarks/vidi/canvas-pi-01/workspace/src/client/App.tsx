/**
 * Story 1 · top-level layout.
 *
 * The camera lives in `useCamera`, created with the measured size of the board
 * area, shared through `CameraApiContext`, and wired to the three
 * presentational pieces: the input surface, the zoom control and the hint.
 *
 * Story 2 adds the document model and the sticky notes on top of that
 * navigation surface: `useBoardDoc` owns the Y.Doc, `useSelection` the local
 * selection / editing state, and the two toolbars.
 *
 * Story 3 adds live collaboration: a board attaches a `WebsocketProvider` for
 * its room, and a board change remounts the shell (via `key`) so one board's
 * document, provider and selection never leak into another (PRD live.isolation).
 *
 * Story 5 takes over the *routing*. `App` is now a three-way switch driven by
 * `useRoute()`: home, board, not-found. The story 3 stopgap — every address
 * minting a random board, including a mistyped one — is gone; a board address is
 * resolved by `BoardPage`, which asks the Worker whether the board exists before
 * mounting anything (PRD share.not_found). `BoardShell` stays board-only and
 * server-free so the stories 1–4 component tests can keep rendering it directly.
 */
import { BoardShell, canEdit } from './board/BoardShell';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Re-exported so the stories 1–4 component tests keep importing them from
// `App`; the implementations live in `board/BoardShell.tsx`.
export { BoardShell, canEdit };

export function App() {
  const route = useRoute();

  if (route.name === 'home') return <HomePage />;
  if (route.name === 'not_found') return <NotFoundPage />;

  // `key` remounts per board: a fresh document, provider and selection (PRD
  // live.isolation). A board whose id is not well-formed still renders through
  // `BoardPage`, which shows "Board not found" without touching the network.
  return <BoardPage key={route.id} id={route.id} />;
}
