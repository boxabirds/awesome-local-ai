import { useRef } from 'react';
import type { JSX } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { useCamera, useViewportSize } from './canvas/useCamera';

/**
 * Top-level layout: the infinite board fills the window, the zoom control floats in
 * the bottom-right corner and the first-use hint near the bottom centre.
 */
export function App(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);

  return (
    <div className="board-app" data-testid="board-root" ref={rootRef}>
      <BoardViewport />
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
