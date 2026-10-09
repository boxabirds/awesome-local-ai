/**
 * Top-level layout for vidi6.
 *
 * The board fills the whole window. `Board` measures its pixel size
 * (synchronously, then via ResizeObserver) so camera maths always knows the
 * viewport, and shares the camera API with the board viewport. Zoom controls
 * and the navigation hint join here in the following tasks.
 */
import { useEffect, useRef, useState } from "react";
import { BoardViewport } from "./canvas/BoardViewport";
import { CameraContext, useCamera } from "./canvas/useCamera";
import {
  canZoomIn,
  canZoomOut,
  type Size,
  zoomPercent,
} from "./canvas/camera";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { installTestHooks } from "./canvas/testHooks";

function Board() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const api = useCamera(size);

  // The board is full-window: track the actual pixel size of the container so
  // reset/step zoom can target the true centre. Camera x,y are intentionally
  // unchanged by resize (only the size is updated).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { clientWidth, clientHeight } = el;
      setSize((prev) =>
        prev.width === clientWidth && prev.height === clientHeight
          ? prev
          : { width: clientWidth, height: clientHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    installTestHooks(() => api.camera, api.setCamera);
  }, [api.camera, api.setCamera]);

  return (
    <div ref={containerRef} className="board-root">
      <CameraContext.Provider value={api}>
        <BoardViewport />
      </CameraContext.Provider>
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep("in")}
        onZoomOut={() => api.zoomStep("out")}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}

export function App() {
  return <Board />;
}
