import type { JSX } from 'react';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraProvider, useCameraContext } from './canvas/useCamera';

export function App(): JSX.Element {
  return (
    <CameraProvider>
      <Board />
    </CameraProvider>
  );
}

/**
 * Top-level layout: the infinite board fills the window, the zoom control sits
 * in the bottom-right corner and the first-use hint near the bottom centre.
 * Everything is wired to the one camera the board area owns.
 */
function Board(): JSX.Element {
  const { camera, hasNavigated, zoomStep, reset } = useCameraContext();
  return (
    <>
      <BoardViewport />
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
