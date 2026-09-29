import { render, RenderResult } from '@testing-library/react';
import { CameraContext } from '@/client/canvas/CameraContext';
import { useCamera } from '@/client/canvas/useCamera';
import { BoardViewport } from '@/client/canvas/BoardViewport';
import { ZoomControls } from '@/client/canvas/ZoomControls';
import { NavigationHint } from '@/client/canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent } from '@/client/canvas/camera';

const TEST_VIEWPORT = { width: 1280, height: 800 };

function TestApp() {
  const cameraState = useCamera(TEST_VIEWPORT);
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

export function renderApp(): RenderResult {
  return render(<TestApp />);
}

export function getCameraTransform(container: HTMLElement): string {
  const worldLayer = container.querySelector('[data-testid="world-layer"]');
  if (!worldLayer) throw new Error('world layer not found');
  return (worldLayer as HTMLElement).style.transform;
}
