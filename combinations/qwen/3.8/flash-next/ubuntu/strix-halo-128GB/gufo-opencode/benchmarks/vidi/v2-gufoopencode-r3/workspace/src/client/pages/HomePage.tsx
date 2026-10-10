import { NewBoardButton } from './NewBoardButton';

export function HomePage() {
  return (
    <main className="page home-page">
      <h1 className="home-title">vidi6</h1>
      <p className="home-tagline">A shared board for thinking together</p>
      <NewBoardButton className="new-board-button home-new-board" />
    </main>
  );
}
