import type { JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraApiContext, useCamera, useViewportSize } from './canvas/useCamera';

/**
 * Full-window board with the zoom control and the first-use hint. `App` owns the
 * camera so the controls can be derived from it; the viewport reads the same API
 * through context. Nothing is persisted: reloading discards the view.
 */
export function App(): JSX.Element {
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;

  return (
    <CameraApiContext.Provider value={cameraApi}>
      <main className="vidi6-app" data-testid="app">
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
      </main>
    </CameraApiContext.Provider>
  );
}
