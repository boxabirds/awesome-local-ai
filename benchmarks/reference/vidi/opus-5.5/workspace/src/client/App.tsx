import { useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';

const UNMEASURED: Size = { width: 0, height: 0 };

export function App() {
  const [viewport, setViewport] = useState<Size>(UNMEASURED);
  const controller = useCamera(viewport);
  const { camera } = controller;

  return (
    <main className="app">
      <BoardViewport controller={controller} onResize={setViewport} />
      <NavigationHint visible={!controller.hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
    </main>
  );
}
