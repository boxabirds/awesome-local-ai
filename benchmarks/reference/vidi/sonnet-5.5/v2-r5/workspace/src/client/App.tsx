import { BoardViewport } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

export function App() {
  return (
    <BoardViewport
      overlay={(api) => (
        <>
          <NavigationHint visible={!api.hasNavigated} />
          <ZoomControls
            zoomPercent={zoomPercent(api.camera)}
            canZoomIn={canZoomIn(api.camera)}
            canZoomOut={canZoomOut(api.camera)}
            onZoomIn={() => api.zoomStep('in')}
            onZoomOut={() => api.zoomStep('out')}
            onReset={api.reset}
          />
        </>
      )}
    />
  );
}
