import { BoardViewport } from './canvas/BoardViewport';

/**
 * Top-level layout: a full-window board. Board chrome (zoom controls, first-use
 * hint) is rendered by BoardViewport, which owns the camera state.
 */
export function App() {
  return (
    <main className="app" data-app="vidi6">
      <BoardViewport />
    </main>
  );
}
