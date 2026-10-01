import { Board } from '../../src/client/board/Board';

/** The board screen for the id in the current location, without the page-level existence check (story 5). */
export function App() {
  const id = location.pathname.split('/')[2];
  return <Board key={id} boardId={id} />;
}
