import { NewBoardButton } from './NewBoardButton';

export function HomePage() {
  return (
    <main className="page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-text">A shared board for thinking together</p>
      <NewBoardButton />
    </main>
  );
}
