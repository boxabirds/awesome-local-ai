import type { JSX } from 'react';

import { BoardViewport } from './canvas/BoardViewport.js';
import { NavigationHint } from './canvas/NavigationHint.js';
import { ZoomControls } from './canvas/ZoomControls.js';
import {
  CameraProvider,
  useCamera,
  useCameraContextValue,
  useViewportSize,
} from './canvas/useCamera.js';

/**
 * Top-level layout: the board fills the window, with the zoom controls in the
 * bottom-right corner and the first-use hint at the bottom centre. The camera
 * lives here (one camera per visit, per device) and is shared with the board
 * surface through context.
 */
export function App(): JSX.Element {
  const viewport = useViewportSize();
  const api = useCamera(viewport);
  const context = useCameraContextValue(api, viewport);

  return (
    <div className="app" data-testid="app">
      <CameraProvider value={context}>
        <BoardViewport />
      </CameraProvider>
      <ZoomControls
        zoomPercent={context.zoomPercent}
        canZoomIn={context.canZoomIn}
        canZoomOut={context.canZoomOut}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}
