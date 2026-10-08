import { useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraContext, useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { installVidi6TestHooks } from './canvas/testHooks';

/** Board background colour (the dot grid is drawn on top). */
const BOARD_BACKGROUND = '#f8f8f6';
/** Origin marker (small crosshair at world 0,0): a stable e2e pixel target. */
const ORIGIN_MARKER_HALF_PX = 6;
const ORIGIN_MARKER_COLOR = '#8f8f86';

/**
 * Small crosshair at the board's starting point (world 0,0), rendered in
 * all builds so e2e tests have a stable pixel target.
 */
function OriginMarker(): JSX.Element {
  return (
    <div
      data-testid="origin-marker"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -ORIGIN_MARKER_HALF_PX,
        top: -ORIGIN_MARKER_HALF_PX,
        width: ORIGIN_MARKER_HALF_PX * 2,
        height: ORIGIN_MARKER_HALF_PX * 2,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ORIGIN_MARKER_HALF_PX - 0.5,
          width: '100%',
          height: 1,
          background: ORIGIN_MARKER_COLOR,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: ORIGIN_MARKER_HALF_PX - 0.5,
          top: 0,
          width: 1,
          height: '100%',
          background: ORIGIN_MARKER_COLOR,
        }}
      />
    </div>
  );
}

export function App(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth || 1,
    height: window.innerHeight || 1,
  }));

  // Viewport size from a ResizeObserver (window resize never moves content:
  // the camera is anchored to the top-left and carries no size).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const update = (): void => {
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    // Fallback for environments without ResizeObserver (e.g. jsdom).
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const cameraController = useCamera(viewport);

  // Test-only hook (no-op and tree-shaken in production builds).
  useEffect(() => {
    installVidi6TestHooks(cameraController.setCamera);
  }, [cameraController.setCamera]);

  return (
    <CameraContext.Provider value={cameraController}>
      <div
        ref={rootRef}
        data-testid="app-root"
        style={{ position: 'fixed', inset: 0, background: BOARD_BACKGROUND }}
      >
        <BoardViewport>
          <OriginMarker />
        </BoardViewport>
        <ZoomControls
          zoomPercent={zoomPercent(cameraController.camera)}
          canZoomIn={canZoomIn(cameraController.camera)}
          canZoomOut={canZoomOut(cameraController.camera)}
          onZoomIn={() => cameraController.zoomStep('in')}
          onZoomOut={() => cameraController.zoomStep('out')}
          onReset={cameraController.reset}
        />
        <NavigationHint visible={!cameraController.hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
