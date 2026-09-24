import { useEffect, useRef, useState } from 'react';
import type { Size } from './canvas/camera';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';

/**
 * Top-level layout: full-window board plus the zoom controls and the
 * first-use hint. The single camera instance lives here and is shared with
 * every canvas piece.
 */
export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // Track the board area size; resizing the window only changes the viewport
  // size, never the camera (content stays fixed to the board's top-left).
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const api = useCamera(size);

  return (
    <div className="vidi6-shell" ref={shellRef}>
      <BoardViewport api={api} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}
