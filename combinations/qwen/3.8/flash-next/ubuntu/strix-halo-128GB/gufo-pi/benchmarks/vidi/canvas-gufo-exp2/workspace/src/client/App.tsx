import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardCameraProvider, useBoardCamera } from './canvas/cameraContext';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

export function App() {
  return (
    <BoardCameraProvider>
      <BoardViewport />
      <BoardChrome />
    </BoardCameraProvider>
  );
}

/** Fixed-position chrome wired to the board camera. */
function BoardChrome() {
  const board = useBoardCamera();
  const { camera } = board;
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => board.zoomStep('in')}
        onZoomOut={() => board.zoomStep('out')}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
    </>
  );
}
