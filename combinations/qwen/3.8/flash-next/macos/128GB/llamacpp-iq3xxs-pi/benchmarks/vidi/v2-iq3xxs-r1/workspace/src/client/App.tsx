import { BoardCameraProvider, BoardViewport, useBoardCamera } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import {
  canZoomIn as camCanZoomIn,
  canZoomOut as camCanZoomOut,
  zoomPercent,
} from './canvas/camera';

function ZoomControlsConnector() {
  const { camera, zoomStep, reset } = useBoardCamera();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={camCanZoomIn(camera)}
      canZoomOut={camCanZoomOut(camera)}
      onZoomIn={() => zoomStep('in')}
      onZoomOut={() => zoomStep('out')}
      onReset={reset}
    />
  );
}

function NavigationHintConnector() {
  const { hasNavigated } = useBoardCamera();
  return <NavigationHint visible={!hasNavigated} />;
}

export function App() {
  return (
    <BoardCameraProvider>
      <BoardViewport />
      <ZoomControlsConnector />
      <NavigationHintConnector />
    </BoardCameraProvider>
  );
}
