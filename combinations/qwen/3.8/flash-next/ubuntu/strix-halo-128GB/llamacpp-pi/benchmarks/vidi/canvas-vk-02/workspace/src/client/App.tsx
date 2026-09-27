import { useCallback, useRef } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraContext, useCamera } from './canvas/useCamera';
import { useTestHooks } from './canvas/testHooks';
import { useViewportSize } from './canvas/useViewportSize';

/**
 * Top level: one board, one camera. The camera is owned here so the zoom
 * controls and the navigation hint read from it, while the board itself renders
 * and handles input through the context.
 */
export default function App() {
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(boardAreaRef);
  const cameraApi = useCamera(viewport);
  useTestHooks(cameraApi);

  const { camera, hasNavigated, zoomStep, reset } = cameraApi;
  const onZoomIn = useCallback(() => zoomStep('in'), [zoomStep]);
  const onZoomOut = useCallback(() => zoomStep('out'), [zoomStep]);

  return (
    <CameraContext.Provider value={cameraApi}>
      <div className="board-area" data-testid="board-area" ref={boardAreaRef}>
        <BoardViewport />
      </div>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </CameraContext.Provider>
  );
}
