import { useMemo, useState } from 'react';
import { BoardContext, type BoardContextValue } from './canvas/BoardContext';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function App(): React.JSX.Element {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const board = useCamera(viewport);
  const context = useMemo<BoardContextValue>(() => ({ board, setViewport }), [board]);
  const { camera } = board;

  return (
    <BoardContext.Provider value={context}>
      <main className="app">
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
      </main>
    </BoardContext.Provider>
  );
}
