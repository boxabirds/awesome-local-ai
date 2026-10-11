import type { JSX } from 'react';

import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { BoardProvider, useBoard } from './canvas/Board';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

export function App(): JSX.Element {
  return (
    <BoardProvider>
      <BoardViewport />
      <BoardChrome />
    </BoardProvider>
  );
}

/** The on-board chrome (zoom control and first-use hint), wired to the camera. */
function BoardChrome(): JSX.Element {
  const board = useBoard();
  const { camera } = board;

  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => board.zoomStep('in')}
        onZoomOut={() => board.zoomStep('out')}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
    </>
  );
}
