import { useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';

/**
 * Top-level layout. The camera lives in useCamera; the viewport reports its
 * size up so zoom steps and Reset view can anchor to the board area's
 * centre. Zoom controls and the hint float above the board and are not part
 * of the board's input surface.
 */
export function App() {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);

  return (
    <div className="app">
      <BoardViewport
        camera={cam.camera}
        onViewportSize={setViewport}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomAtPoint={cam.zoomAtPoint}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
      >
        {/* Board content (sticky notes, shapes, ...) is added here in stories 2+. */}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
