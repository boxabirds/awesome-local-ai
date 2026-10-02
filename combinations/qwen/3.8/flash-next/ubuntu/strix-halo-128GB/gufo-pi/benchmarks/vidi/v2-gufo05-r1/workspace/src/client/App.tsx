/**
 * Top-level layout: the full-window board plus its fixed overlays.
 *
 * `CameraProvider` owns the camera (`useCamera`); `BoardLayout` reads it and
 * wires it to the viewport, the zoom controls and the navigation hint.
 */
import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useCameraContext } from './canvas/CameraContext';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';

function BoardLayout() {
  const nav = useCameraContext();
  const { camera } = nav;
  return (
    <div className="app">
      <BoardViewport />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          nav.zoomStep('in');
        }}
        onZoomOut={() => {
          nav.zoomStep('out');
        }}
        onReset={nav.reset}
      />
      <NavigationHint visible={!nav.hasNavigated} />
    </div>
  );
}

export function App() {
  return (
    <CameraProvider>
      <BoardLayout />
    </CameraProvider>
  );
}
