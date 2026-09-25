import { useState, useEffect, useCallback } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { CameraContext } from './canvas/CameraContext';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { initGlobalTestHooks } from './canvas/testHooks';

export function App() {
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  const updateViewport = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, [updateViewport]);

  const cameraState = useCamera(viewport);

  useEffect(() => {
    initGlobalTestHooks();
  }, []);

  return (
    <CameraContext.Provider value={cameraState}>
      <BoardViewport />
      <ZoomControls
        zoomPercent={zoomPercent(cameraState.camera)}
        canZoomIn={canZoomIn(cameraState.camera)}
        canZoomOut={canZoomOut(cameraState.camera)}
        onZoomIn={() => cameraState.zoomStep('in')}
        onZoomOut={() => cameraState.zoomStep('out')}
        onReset={cameraState.reset}
      />
      <NavigationHint visible={!cameraState.hasNavigated} />
    </CameraContext.Provider>
  );
}
