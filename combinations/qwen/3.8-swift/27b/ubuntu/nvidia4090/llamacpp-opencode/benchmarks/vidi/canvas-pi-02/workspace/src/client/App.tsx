// Top-level layout: full-window board, bottom-right zoom controls,
// bottom-centre first-use hint. One shared camera instance drives all three.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';

function useViewportSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export default function App(): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const camera = useCamera(viewport);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  useEffect(() => {
    installTestHooks(() => cameraRef.current);
  }, []);

  return (
    <div className="board-root" ref={rootRef}>
      <BoardViewport camera={camera} />
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={() => camera.reset()}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </div>
  );
}
