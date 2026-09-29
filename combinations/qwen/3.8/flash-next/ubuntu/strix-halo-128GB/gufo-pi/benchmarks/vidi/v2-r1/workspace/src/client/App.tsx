import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { useCamera, useViewportSize } from './canvas/useCamera';

/**
 * Story 1: a full-window infinite board the user can pan and zoom around.
 *
 * The camera lives here so the viewport, the zoom controls and the navigation
 * hint all share one camera. Nothing is persisted: a reload starts from the
 * standard view again.
 */
export function App() {
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;

  return (
    <>
      <BoardViewport camera={cameraApi} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={cameraApi.reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}
