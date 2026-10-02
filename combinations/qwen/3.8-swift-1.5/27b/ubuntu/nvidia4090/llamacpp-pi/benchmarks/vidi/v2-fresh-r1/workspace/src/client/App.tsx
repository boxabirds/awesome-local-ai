// Top-level layout: full-window board viewport, zoom controls (bottom
// right) and first-use navigation hint (bottom centre).

import { useEffect, useRef } from 'react';
import { BoardViewport, CameraContext } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { installTestHooks } from './canvas/testHooks';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useViewportSize(rootRef);
  const cameraApi = useCamera(size);
  const { camera, hasNavigated } = cameraApi;
  const setCamera = cameraApi.setCamera;

  // Test-only `window.__vidi6` hook (test mode only, see testHooks.ts).
  useEffect(() => {
    installTestHooks(setCamera);
  }, [setCamera]);

  return (
    <CameraContext.Provider value={cameraApi}>
      <div ref={rootRef} className="app-root" data-testid="app-root">
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => cameraApi.zoomStep('in')}
          onZoomOut={() => cameraApi.zoomStep('out')}
          onReset={cameraApi.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
