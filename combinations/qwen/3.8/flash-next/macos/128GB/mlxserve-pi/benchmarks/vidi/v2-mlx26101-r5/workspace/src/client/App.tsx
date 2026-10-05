import { useEffect, useRef, useState } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { registerTestHooks } from './canvas/testHooks';

/** The board fills the window; its size is the camera's viewport. */
const measureWindow = (): Size =>
  typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/**
 * Top-level layout: the infinite board, the bottom-right zoom control and the
 * first-use navigation hint. One camera (`useCamera`) is shared by all three.
 */
export default function App(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>(measureWindow);
  const controller = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  // Viewport size from a ResizeObserver. A resize changes only the size: the
  // camera's x/y (world point at the top-left) stays put.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setViewport((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Test-only hook (excluded from production builds by the mode check).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return registerTestHooks({
      setCamera: (patch) => controllerRef.current.setCamera(patch),
      getCamera: () => controllerRef.current.camera,
    });
  }, []);

  const { camera } = controller;

  return (
    <div className="vidi6-app" data-testid="app" ref={containerRef}>
      <BoardViewport controller={controller} />
      <ZoomControls
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onReset={controller.reset}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        zoomPercent={zoomPercent(camera)}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </div>
  );
}
