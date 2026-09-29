import type { ReactNode } from 'react';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport, useBoardCamera } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

/**
 * Screen-space chrome over the board: the zoom control (bottom-right) and the
 * first-use navigation hint (bottom-centre). It reads the camera that
 * <BoardViewport> owns, so the zoom percentage and the disabled buttons always
 * match the camera.
 */
function BoardChrome(): ReactNode {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** Full-window board. */
export function App(): ReactNode {
  return (
    <BoardViewport chrome={<BoardChrome />}>
      {/* Board objects (sticky notes arrive in story 2) render here in world coordinates. */}
    </BoardViewport>
  );
}
