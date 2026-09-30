// Top-level layout: the board fills the window, the zoom control sits in the
// bottom-right corner and the first-use hint near the bottom centre.

import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useBoardCamera } from './canvas/CameraProvider';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';

/** Fixed-position UI wired to the board camera. */
function BoardChrome() {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
  return (
    <>
      <NavigationHint visible={!hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
    </>
  );
}

export default function App() {
  return (
    <CameraProvider>
      <BoardViewport />
      <BoardChrome />
    </CameraProvider>
  );
}
