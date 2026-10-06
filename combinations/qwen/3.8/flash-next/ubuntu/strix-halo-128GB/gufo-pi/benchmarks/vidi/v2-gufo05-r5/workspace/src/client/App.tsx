import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useBoardCamera } from './canvas/CameraProvider';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

export function App() {
  return (
    <CameraProvider>
      <BoardViewport />
      <BoardChrome />
    </CameraProvider>
  );
}

/**
 * The on-screen navigation chrome, wired to the board camera. Board objects added by
 * later stories render inside BoardViewport (in world coordinates).
 */
function BoardChrome() {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
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
