import { BoardViewport } from './canvas/BoardViewport';

/**
 * Top-level layout. In this story the board is empty: the dot grid and the
 * first-use hint are the empty state. BoardViewport owns the camera and renders
 * the zoom controls and hint.
 */
export default function App() {
  return <BoardViewport />;
}
