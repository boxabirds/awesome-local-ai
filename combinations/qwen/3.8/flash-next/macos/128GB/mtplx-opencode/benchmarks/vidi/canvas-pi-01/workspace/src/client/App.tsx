/**
 * Story 1 · top-level layout.
 *
 * The camera lives in `useCamera`, created here with the measured size of the
 * board area, shared through `CameraApiContext`, and wired to the three
 * presentational pieces: the input surface, the zoom control and the hint.
 */
import { useRef } from 'react';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import type { Size } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraApiContext, useCamera, useViewportSize } from './canvas/useCamera';

/**
 * The board, given the size of the area it occupies. Split out from `App` so
 * component tests can render the real tree with a fixed viewport size.
 */
export function BoardShell({ viewport }: { viewport: Size }) {
  const api = useCamera(viewport);
  const camera = api.camera;

  return (
    <CameraApiContext.Provider value={api}>
      <div className="board-root" data-testid="board-root">
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={() => api.reset()}
        />
        <NavigationHint visible={!api.hasNavigated} />
      </div>
    </CameraApiContext.Provider>
  );
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(stageRef);

  return (
    <div ref={stageRef} className="board-root" data-testid="board-stage">
      <BoardShell viewport={viewport} />
    </div>
  );
}