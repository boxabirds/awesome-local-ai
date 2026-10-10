import { useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Size
} from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { BoardCameraContext, useCamera } from './canvas/useCamera';

function measure(el: HTMLElement | null): Size {
  const width = el?.clientWidth || window.innerWidth;
  const height = el?.clientHeight || window.innerHeight;
  return { width, height };
}

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>(() => measure(null));
  useEffect(() => {
    const update = () => {
      const next = measure(rootRef.current);
      setViewport((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    update();
    const el = rootRef.current;
    if (typeof ResizeObserver !== 'undefined' && el !== null) {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const board = useCamera(viewport);

  useEffect(() => {
    installTestHooks(board.setCamera);
  }, [board.setCamera]);

  const { camera, hasNavigated } = board;

  return (
    <BoardCameraContext.Provider value={board}>
      <div ref={rootRef} className="board-root">
        <BoardViewport />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </BoardCameraContext.Provider>
  );
}
