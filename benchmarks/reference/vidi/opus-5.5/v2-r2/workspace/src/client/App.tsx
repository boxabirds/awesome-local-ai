import { useMemo, useState } from 'react';
import { type Size, canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { BoardCameraContext, useCamera } from './canvas/useCamera';

function initialViewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function App(): React.JSX.Element {
  const [viewportSize, setViewportSize] = useState<Size>(initialViewportSize);
  const board = useCamera(viewportSize);
  const context = useMemo(() => ({ ...board, setViewportSize }), [board]);
  const { camera } = board;

  return (
    <BoardCameraContext.Provider value={context}>
      <main className="app">
        <BoardViewport />
        <NavigationHint visible={!board.hasNavigated} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
      </main>
    </BoardCameraContext.Provider>
  );
}
