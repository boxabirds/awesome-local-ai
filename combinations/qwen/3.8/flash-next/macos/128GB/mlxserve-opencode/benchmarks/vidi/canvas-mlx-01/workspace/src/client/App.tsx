import { useCallback, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport.js';
import { NavigationHint } from './canvas/NavigationHint.js';
import { ZoomControls } from './canvas/ZoomControls.js';
import { useCamera } from './canvas/useCamera.js';
import type { Size } from './canvas/camera.js';

/**
 * Top-level layout: the full-window board, the zoom control in the bottom-right
 * corner and the first-use hint at the bottom centre. Nothing here is persisted;
 * reloading the page starts again from the board's starting point at 100%.
 */
export function App(): JSX.Element {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);
  const onViewportSize = useCallback((size: Size): void => {
    setViewport(size);
  }, []);

  return (
    <>
      <BoardViewport api={camera} onViewportSize={onViewportSize} />
      <ZoomControls
        zoomPercent={camera.zoomPercent}
        canZoomIn={camera.canZoomIn}
        canZoomOut={camera.canZoomOut}
        onZoomIn={() => {
          camera.zoomStep('in');
        }}
        onZoomOut={() => {
          camera.zoomStep('out');
        }}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </>
  );
}
