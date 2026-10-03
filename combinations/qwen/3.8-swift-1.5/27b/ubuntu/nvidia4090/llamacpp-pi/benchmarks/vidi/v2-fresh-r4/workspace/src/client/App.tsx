import { useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { type Size, canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';

/** Top-level layout: full-window board, zoom controls, first-use hint. */
export default function App(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return undefined;
  }, []);

  return (
    <div className="app-root" ref={rootRef}>
      <BoardViewport
        camera={camera.camera}
        hasNavigated={camera.hasNavigated}
        beginPan={camera.beginPan}
        panMove={camera.panMove}
        endPan={camera.endPan}
        wheel={camera.wheel}
        zoomStep={camera.zoomStep}
        reset={camera.reset}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </div>
  );
}
