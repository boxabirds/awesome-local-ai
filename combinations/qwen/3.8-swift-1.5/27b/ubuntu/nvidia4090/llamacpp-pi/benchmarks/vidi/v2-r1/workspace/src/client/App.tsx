import { useRef, useState, useEffect } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { setupTestHooks } from './canvas/testHooks';

export function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);

  // Set up test hooks in test mode
  useEffect(() => {
    setupTestHooks(cam);
  }, [cam]);

  return (
    <div ref={viewportRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomAtPointer={cam.zoomAtPointer}
        zoomStep={cam.zoomStep}
        reset={cam.reset}
        isPanning={cam.isPanning}
      />
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
