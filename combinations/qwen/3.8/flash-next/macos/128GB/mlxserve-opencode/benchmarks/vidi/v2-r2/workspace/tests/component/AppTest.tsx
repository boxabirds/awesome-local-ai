import { useEffect } from 'react';
import { useCamera } from '../../src/client/canvas/useCamera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent, Size } from '../../src/client/canvas/camera';

export function AppTest({ viewport }: { viewport?: Size } = {}) {
  const size = viewport || { width: 1280, height: 800 };
  const cam = useCamera(size);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key;
      if (key === '=' || key === '+') {
        e.preventDefault();
        cam.zoomStep('in');
      } else if (key === '-') {
        e.preventDefault();
        cam.zoomStep('out');
      } else if (key === '0') {
        e.preventDefault();
        cam.reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cam.zoomStep, cam.reset]);

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        onPointerDown={cam.beginPan}
        onPointerMove={cam.panMove}
        onPointerUp={cam.endPan}
        onWheel={cam.wheel}
        onGestureStart={cam.gestureStart}
        onGestureChange={cam.gestureChange}
      />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}
