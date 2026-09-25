import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraProvider, useCameraApi } from './canvas/useCamera';

/** Fixed overlays that read the board camera: zoom control and first-use hint. */
export function BoardOverlays() {
  const { camera, hasNavigated, zoomStep, reset } = useCameraApi();

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

export default function App() {
  return (
    <CameraProvider>
      <BoardViewport />
      <BoardOverlays />
    </CameraProvider>
  );
}
