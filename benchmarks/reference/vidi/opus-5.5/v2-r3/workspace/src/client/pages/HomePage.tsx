// Home page (share.create): product name, one-line description, New board.
import { NewBoardButton } from './NewBoardButton';
import { useCreateBoard } from './useCreateBoard';

export function HomePage() {
  const { state, create } = useCreateBoard();
  return (
    <main className="page home-page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-lead">A shared board for thinking together</p>
      <NewBoardButton state={state} onCreate={create} />
    </main>
  );
}
