import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraContext, useCamera, useViewportSize } from './canvas/useCamera';

export default function App() {
  const viewport = useViewportSize();
  const board = useCamera(viewport);
  const { camera } = board;

  return (
    <CameraContext.Provider value={board}>
      <div className="vidi6-app">
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
