import { useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport.tsx';
import { ZoomControls } from './canvas/ZoomControls.tsx';
import { NavigationHint } from './canvas/NavigationHint.tsx';
import { useCamera } from './canvas/useCamera.ts';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Size,
} from './canvas/camera.ts';

/**
 * Top-level layout: a full-window board area, the bottom-right zoom control, and
 * the first-use navigation hint. Viewport size is measured with a ResizeObserver;
 * the camera is independent of resize (resize only changes what is visible).
 */
export default function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 1280, height: 800 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setViewport({ width: r.width, height: r.height });
    });
    ro.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cam = useCamera(viewport);

  return (
    <div data-testid="app" className="vidi6-root">
      <BoardViewport camera={cam.camera} viewportRef={viewportRef} api={cam}>
        {/* Board objects (sticky notes, shapes) arrive in later stories. */}
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
