import { type JSX, useState, useEffect } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { useCamera } from './canvas/useCamera';

export function App(): JSX.Element {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cam = useCamera(size);

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomStepIn={cam.zoomStepIn}
        zoomStepOut={cam.zoomStepOut}
        reset={cam.reset}
        setCamera={cam.setCamera}
      />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={cam.zoomStepIn}
        onZoomOut={cam.zoomStepOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}
