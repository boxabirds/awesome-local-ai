// Shared harness for component tests: a fixed-size viewport with the camera
// hook wired to BoardViewport, plus optional zoom controls and hint.

import { BoardViewport, CameraContext } from '../../src/client/canvas/BoardViewport';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from '../../src/client/canvas/camera';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { useCamera } from '../../src/client/canvas/useCamera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

/** Viewport size used by the harness (default laptop). */
export const HARNESS_VIEWPORT: Size = { width: 1280, height: 800 };

export function Harness(props: {
  size?: Size;
  withControls?: boolean;
  withHint?: boolean;
}) {
  const { size = HARNESS_VIEWPORT, withControls = false, withHint = false } = props;
  const api = useCamera(size);

  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport />
        {withControls && (
          <ZoomControls
            zoomPercent={zoomPercent(api.camera)}
            canZoomIn={canZoomIn(api.camera)}
            canZoomOut={canZoomOut(api.camera)}
            onZoomIn={() => api.zoomStep('in')}
            onZoomOut={() => api.zoomStep('out')}
            onReset={api.reset}
          />
        )}
        {withHint && <NavigationHint visible={!api.hasNavigated} />}
      </div>
    </CameraContext.Provider>
  );
}
