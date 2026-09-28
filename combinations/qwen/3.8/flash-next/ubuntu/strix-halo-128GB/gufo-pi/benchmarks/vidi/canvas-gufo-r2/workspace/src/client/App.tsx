import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport, useBoardCamera } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

/**
 * Screen-space chrome over the board: the zoom control and the first-use hint.
 * It lives in the board's overlay so it can read the camera from context while
 * staying unscaled with the board.
 */
function BoardChrome() {
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

/**
 * Top-level layout: the infinite board fills the window.
 * Stories 2-5 add board content as `<BoardViewport>` children and more chrome.
 */
export function App() {
  return <BoardViewport overlay={<BoardChrome />} />;
}
