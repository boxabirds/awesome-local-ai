import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { setupTestHooks } from './canvas/testHooks';
import { useState, useEffect, useRef } from 'react';
import type { Size } from './canvas/camera';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCameraDirect } = useCamera(viewport);

  // Setup test hooks
  useEffect(() => {
    setupTestHooks(setCameraDirect);
  }, [setCameraDirect]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <BoardViewport
        camera={camera}
        viewport={viewport}
        beginPan={beginPan}
        panMove={panMove}
        endPan={endPan}
        wheel={wheel}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
