import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { useCamera, useWindowSize } from "./canvas/useCamera";

/**
 * Story 1: a full-window infinite board with pan, zoom and orientation cues.
 * The camera lives here so the viewport, the zoom controls and the
 * navigation hint all share one instance.
 */
export function App() {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);

  return (
    <CameraApiContext.Provider value={board}>
      <BoardViewport>
        {/* Board objects (sticky notes from story 2) render here. */}
      </BoardViewport>
      <ZoomControls
        zoomPercent={board.zoomPercent}
        canZoomIn={board.canZoomIn}
        canZoomOut={board.canZoomOut}
        onZoomIn={() => board.zoomStep("in")}
        onZoomOut={() => board.zoomStep("out")}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
    </CameraApiContext.Provider>
  );
}
