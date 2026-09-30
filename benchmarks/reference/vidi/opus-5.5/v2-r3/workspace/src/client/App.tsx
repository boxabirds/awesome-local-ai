import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { CameraContext, useCamera, type CameraContextValue } from './canvas/useCamera';
import { installTestHooks } from './testHooks';

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function App() {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const api = useCamera(viewport);
  const { camera } = api;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({ setCamera: api.setCamera, getCamera: () => cameraRef.current });
  }, [api.setCamera]);

  const ctx = useMemo<CameraContextValue>(() => ({ api, onViewportResize: setViewport }), [api]);

  return (
    <CameraContext.Provider value={ctx}>
      <main className="app">
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={api.reset}
        />
        <NavigationHint visible={!api.hasNavigated} />
      </main>
    </CameraContext.Provider>
  );
}
