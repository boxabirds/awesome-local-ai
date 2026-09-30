import type { ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoard } from './canvas/BoardContext';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';

// Fixed-position chrome, wired to the camera owned by <BoardViewport>. Lives
// inside the board context (via the overlay slot) so it renders above the world
// layer without inheriting its transform.
function BoardOverlay(): ReactElement {
  const { camera, hasNavigated, zoomStep, reset } = useBoard();
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

export function App(): ReactElement {
  return (
    <div className="vidi6-app">
      <BoardViewport overlay={<BoardOverlay />} />
    </div>
  );
}
