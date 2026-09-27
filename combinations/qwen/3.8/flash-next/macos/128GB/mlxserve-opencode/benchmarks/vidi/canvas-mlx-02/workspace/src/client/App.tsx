import { BoardViewportRoot, useBoardCamera } from './canvas/BoardViewport.tsx';
import { ZoomControls } from './canvas/ZoomControls.tsx';
import { NavigationHint } from './canvas/NavigationHint.tsx';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera.ts';

export default function App() {
  const { api, rootRef } = useBoardCamera();
  const cam = api.camera;

  return (
    <>
      <BoardViewportRoot api={api} rootRef={rootRef} />
      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </>
  );
}
