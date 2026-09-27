// Top-level layout: full-window board plus the zoom controls and the
// first-use hint, all wired to a single shared useCamera instance.

import { useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { installTestHooks } from './canvas/testHooks';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';

export function App() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  // Viewport size from a ResizeObserver; camera x,y are unchanged on resize.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);

  // Test-only hook (excluded from production builds).
  useEffect(() => {
    installTestHooks({ setCamera: cam.setCamera });
  }, [cam.setCamera]);

  return (
    <div ref={rootRef} className="app-root">
      <BoardViewport cam={cam} />
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
