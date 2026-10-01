import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera, useViewportSize } from './canvas/useCamera';

/**
 * Top-level layout: a full-window board, the zoom control in the bottom-right corner and
 * the first-use navigation hint near the bottom centre. The camera lives here so the board
 * and the controls share one source of truth.
 */
export function App() {
  const viewport = useViewportSize();
  const { camera, hasNavigated, ...handlers } = useCamera(viewport);

  return (
    <div className="app-root">
      <BoardViewport camera={camera} handlers={handlers} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => handlers.zoomStep('in')}
        onZoomOut={() => handlers.zoomStep('out')}
        onReset={handlers.reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
