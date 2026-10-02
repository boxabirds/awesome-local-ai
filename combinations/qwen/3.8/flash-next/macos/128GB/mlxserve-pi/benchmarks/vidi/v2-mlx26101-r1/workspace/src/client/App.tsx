import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Point,
  type Size,
} from './canvas/camera';
import { useCamera, type WheelInput } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';

/** Viewport size measured from the live board element via a ResizeObserver. */
function useViewportSize(
  ref: React.RefObject<HTMLDivElement | null>,
): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export default function App() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(surfaceRef);
  const cam = useCamera(viewport);
  const { camera } = cam;

  // Bind the hook's intents so BoardViewport's effects that depend on them do
  // not re-subscribe on every render (the handler identities are stable).
  const onWheelInput = useCallback((e: WheelInput) => cam.wheel(e), [cam.wheel]);
  const onBeginPan = useCallback((p: Point) => cam.beginPan(p), [cam.beginPan]);
  const onPanMove = useCallback((p: Point) => cam.panMove(p), [cam.panMove]);
  const onEndPan = useCallback(() => cam.endPan(), [cam.endPan]);
  const onZoomStep = useCallback((d: 'in' | 'out') => cam.zoomStep(d), [cam.zoomStep]);
  const onReset = useCallback(() => cam.reset(), [cam.reset]);

  return (
    <div className="vidi6-app">
      <BoardViewport
        ref={surfaceRef}
        camera={camera}
        onWheelInput={onWheelInput}
        onBeginPan={onBeginPan}
        onPanMove={onPanMove}
        onEndPan={onEndPan}
        onZoomStep={onZoomStep}
        onReset={onReset}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
