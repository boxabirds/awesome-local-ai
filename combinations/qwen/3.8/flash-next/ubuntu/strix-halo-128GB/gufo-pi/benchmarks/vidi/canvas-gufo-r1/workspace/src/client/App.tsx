import { BoardViewport } from './canvas/BoardViewport';

export function App() {
  // Story 1: an empty, infinite board. BoardViewport owns the camera and renders
  // the dot grid, the (empty) world layer, the zoom controls and the hint.
  return (
    <BoardViewport>
      {/* Board content arrives in story 2+ */}
    </BoardViewport>
  );
}
