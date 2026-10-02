import { useRef } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { useCamera, useElementSize } from './canvas/useCamera';
import { useTestCameraHook } from './canvas/testHooks';

/**
 * Top-level layout: the infinite board fills the window, the zoom control floats
 * bottom-right and the first-use hint bottom-centre. All camera state lives in
 * `useCamera`; the controls are presentational.
 */
export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewport = useElementSize(viewportRef);
  const controller = useCamera(viewport);
  const { camera } = controller;

  useTestCameraHook(controller);

  return (
    <div className="app" data-testid="app">
      <BoardViewport camera={camera} controls={controller} rootRef={viewportRef}>
        {/* Board objects (story 2 onwards) render inside the world layer. */}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </div>
  );
}
