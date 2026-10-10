import { useEffect, useRef } from 'react';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installTestHooks } from './canvas/testHooks';
import { BoardControllerContext, useCamera, useViewportSize } from './canvas/useCamera';

export default function App() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(boardRef);
  const controller = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      installTestHooks(controllerRef);
    }
  }, []);

  const { camera } = controller;

  return (
    <div className="board-root" ref={boardRef} data-testid="board-root">
      <BoardControllerContext.Provider value={controller}>
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => controller.zoomStep('in')}
          onZoomOut={() => controller.zoomStep('out')}
          onReset={controller.reset}
        />
        <NavigationHint visible={!controller.hasNavigated} />
      </BoardControllerContext.Provider>
    </div>
  );
}
