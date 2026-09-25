import { useEffect, useRef } from 'react';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraContext, useCamera, useViewportSize } from './canvas/useCamera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installBoardTestHooks } from './canvas/testHooks';

/**
 * Top-level layout: a full-window board area, the zoom controls in the
 * bottom-right corner and the first-use hint near the bottom centre.
 *
 * The camera api is created here so the controls and the hint can share it;
 * BoardViewport reads it from CameraContext.
 */
export function App() {
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(boardAreaRef);
  const cameraApi = useCamera(viewport);

  const apiRef = useRef(cameraApi);
  useEffect(() => {
    apiRef.current = cameraApi;
  });

  useEffect(() => {
    installBoardTestHooks(() => apiRef.current);
  }, []);

  const camera = cameraApi.camera;

  return (
    <CameraContext.Provider value={cameraApi}>
      <div className="board-area" data-testid="board-area" ref={boardAreaRef}>
        <BoardViewport />
      </div>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={() => cameraApi.reset()}
      />
      <NavigationHint visible={!cameraApi.hasNavigated} />
    </CameraContext.Provider>
  );
}
