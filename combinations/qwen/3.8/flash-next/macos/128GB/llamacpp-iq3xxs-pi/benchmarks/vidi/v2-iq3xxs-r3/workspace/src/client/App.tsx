import type { JSX } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useBoard } from './canvas/CameraProvider';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';

/** Zoom chrome wired to the board camera. */
function BoardZoomControls(): JSX.Element {
  const board = useBoard();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(board.camera)}
      canZoomIn={canZoomIn(board.camera)}
      canZoomOut={canZoomOut(board.camera)}
      onZoomIn={() => board.zoomStep('in')}
      onZoomOut={() => board.zoomStep('out')}
      onReset={board.reset}
    />
  );
}

/** First-use hint, hidden by the first pan or zoom of the visit. */
function BoardNavigationHint(): JSX.Element | null {
  const { hasNavigated } = useBoard();
  return <NavigationHint visible={!hasNavigated} />;
}

export function App(): JSX.Element {
  return (
    <div className="board-app" data-testid="board-app">
      <CameraProvider>
        <BoardViewport />
        <BoardZoomControls />
        <BoardNavigationHint />
      </CameraProvider>
    </div>
  );
}
