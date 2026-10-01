import { useEffect, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { installTestHooks } from './canvas/testHooks';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';

export function App() {
  const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const controller = useCamera(size);
  const { camera, setCamera } = controller;

  useEffect(() => installTestHooks(setCamera), [setCamera]);

  return (
    <>
      <BoardViewport controller={controller} onResize={setSize} />
      <NavigationHint visible={!controller.hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
    </>
  );
}
