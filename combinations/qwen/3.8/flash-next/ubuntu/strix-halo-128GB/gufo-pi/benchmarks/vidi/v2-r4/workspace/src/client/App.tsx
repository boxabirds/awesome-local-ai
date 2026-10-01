import { BoardViewport } from './canvas/BoardViewport.tsx';

/**
 * Top-level layout: a full-window board.
 *
 * Story 1 delivers navigation only; stories 2+ add objects, presence and
 * sharing here.
 */
export function App(): React.JSX.Element {
  return (
    <div className="app">
      <BoardViewport />
    </div>
  );
}
