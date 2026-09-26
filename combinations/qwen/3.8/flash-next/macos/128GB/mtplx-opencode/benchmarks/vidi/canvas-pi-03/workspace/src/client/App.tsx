import { useCallback, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';

function initialSize(): Size {
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  };
}

/**
 * Top-level layout. Owns the single camera (via useCamera) and wires it to the
 * board viewport, the zoom controls and the first-use hint. This is the seam
 * stories 2+ build on.
 */
export function App() {
  const [size, setSize] = useState<Size>(initialSize);
  const api = useCamera(size);
  const cam = api.camera;

  const handleResize = useCallback((next: Size) => {
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
  }, []);

  return (
    <>
      <BoardViewport api={api} onSize={handleResize} />
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

export default App;
