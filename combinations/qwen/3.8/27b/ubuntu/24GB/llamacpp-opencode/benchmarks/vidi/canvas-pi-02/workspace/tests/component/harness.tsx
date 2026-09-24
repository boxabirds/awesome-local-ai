import type { RefObject } from 'react';
import type { Size } from '../../src/client/canvas/camera';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

export interface BoardHarnessProps {
  size?: Size;
  /** Receives the latest CameraApi each render (test observation point). */
  apiRef?: RefObject<CameraApi | null>;
}

/** Test double for App: the same wiring (useCamera -> viewport / controls / hint). */
export function BoardHarness({ size = { width: 1280, height: 800 }, apiRef }: BoardHarnessProps) {
  const api = useCamera(size);
  if (apiRef) apiRef.current = api;
  return (
    <div className="vidi6-shell">
      <BoardViewport api={api} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}
