import { NewBoardButton } from './NewBoardButton';
import { pageStyle } from './useCreateBoard';

export function HomePage() {
  return (
    <main style={pageStyle}>
      <h1 style={{ margin: 0, fontSize: 48 }}>vidi6</h1>
      <p style={{ margin: 0, fontSize: 20, color: '#455A64' }}>A shared board for thinking together</p>
      <NewBoardButton />
    </main>
  );
}
