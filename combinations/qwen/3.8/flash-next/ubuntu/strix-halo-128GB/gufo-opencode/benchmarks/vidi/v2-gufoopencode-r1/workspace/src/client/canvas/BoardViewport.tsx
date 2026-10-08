import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { canZoomIn, canZoomOut, zoomPercent } from './camera';
import type { Point, Size } from './camera';
import { gridStyle, worldLayerStyle } from './boardStyles';
import { NavigationHint } from './NavigationHint';
import { installTestHooks, uninstallTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

// Wheel events with deltaMode LINE/PAGE are converted to pixels with these.
const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 400;

interface GestureEventLike extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

function wheelDeltaPixels(delta: number, deltaMode: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_PIXELS;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * WHEEL_PAGE_PIXELS;
  return delta;
}

function pointRelativeTo(element: Element, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function BoardViewport(props: { children?: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gestureScaleRef = useRef(1);
  const pointerIdRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  const [isPanning, setIsPanning] = useState(false);
  const cam = useCamera(viewport);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      const width = rect !== undefined && rect.width > 0 ? rect.width : window.innerWidth;
      const height = rect !== undefined && rect.height > 0 ? rect.height : window.innerHeight;
      setViewport((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { wheel, gestureZoomAtPointer } = cam;
  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      // Board-owned gestures: never let the page scroll or zoom.
      event.preventDefault();
      wheel({
        deltaX: wheelDeltaPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: pointRelativeTo(element, event.clientX, event.clientY)
      });
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = (event as GestureEventLike).scale || 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const previous = gestureScaleRef.current || 1;
      gestureScaleRef.current = gesture.scale;
      gestureZoomAtPointer(gesture.scale / previous, pointRelativeTo(element, gesture.clientX, gesture.clientY));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart, { passive: false });
    element.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
    };
  }, [wheel, gestureZoomAtPointer]);

  const { zoomStep, reset } = cam;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomStep('in');
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomStep('out');
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const { getCamera, setCamera } = cam;
  useEffect(() => {
    installTestHooks({ getCamera, setCamera });
    return () => uninstallTestHooks();
  }, [getCamera, setCamera]);

  const isBoardSurface = (target: EventTarget | null): boolean => {
    if (target === null) return false;
    const element = target as HTMLElement;
    return element === viewportRef.current || element.dataset.grid === 'true';
  };

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isBoardSurface(event.target)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerIdRef.current = event.pointerId;
      setIsPanning(true);
      cam.beginPan({ x: event.clientX, y: event.clientY });
    },
    [cam]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current === null) return;
      cam.panMove({ x: event.clientX, y: event.clientY });
    },
    [cam]
  );

  const handlePanEnd = useCallback(() => {
    if (pointerIdRef.current === null) return;
    const element = viewportRef.current;
    if (element !== null && pointerIdRef.current !== null && element.hasPointerCapture(pointerIdRef.current)) {
      element.releasePointerCapture(pointerIdRef.current);
    }
    pointerIdRef.current = null;
    setIsPanning(false);
    cam.endPan();
  }, [cam]);

  const camera = cam.camera;

  return (
    <>
      <div
        ref={viewportRef}
        data-testid="board-viewport"
        data-interaction={isPanning ? 'panning' : 'idle'}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          background: '#fbfbf9',
          cursor: isPanning ? 'grabbing' : 'default',
          touchAction: 'none'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onLostPointerCapture={handlePanEnd}
      >
        <div data-testid="dot-grid" data-grid="true" style={gridStyle(camera)} />
        <div data-testid="world-layer" style={{ ...worldLayerStyle(camera), pointerEvents: 'none' }}>
          <div
            data-testid="origin-marker"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 20,
              height: 20,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div style={{ position: 'absolute', left: 9.25, top: 0, width: 1.5, height: 20, background: '#e05252' }} />
            <div style={{ position: 'absolute', left: 0, top: 9.25, width: 20, height: 1.5, background: '#e05252' }} />
          </div>
          {props.children}
        </div>
      </div>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={() => cam.reset()}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}
