import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';

function initialViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Top-level layout: the infinite board fills the window, the zoom control sits in the
 * bottom-right corner and the first-use hint near the bottom centre.
 */
export function App(): JSX.Element {
  const [viewport, setViewport] = useState<Size>(initialViewport);
  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, gesture, zoomStep, reset } =
    useCamera(viewport);

  const handleResize = useCallback((size: Size): void => {
    setViewport((current) =>
      current.width === size.width && current.height === size.height ? current : size,
    );
  }, []);

  const input = { beginPan, panMove, endPan, wheel, gesture, zoomStep, reset };

  return (
    <div className="app" data-testid="app">
      <BoardViewport
        camera={camera}
        viewport={viewport}
        input={input}
        onViewportResize={handleResize}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          zoomStep('in');
        }}
        onZoomOut={() => {
          zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
