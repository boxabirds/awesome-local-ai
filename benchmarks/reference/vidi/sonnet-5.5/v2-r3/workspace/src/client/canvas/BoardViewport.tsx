import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './camera';
import { NavigationHint } from './NavigationHint';
import { installTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

const GRID_DOT_RADIUS_PX = 1;
const GRID_DOT_COLOR = '#c6ccd6';
const HALF = 2;
const MARKER_SIZE_WORLD = 16;

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function readWindowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function BoardViewport({ children }: { children?: ReactNode }) {
  const [size, setSize] = useState<Size>(readWindowSize);
  const cam = useCamera(size);
  const { camera } = cam;
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);

  // Latest handlers for the native listeners below, which are attached once.
  const handlers = useRef(cam);
  handlers.current = cam;

  useEffect(() => installTestHooks((c) => handlers.current.setCamera(c)), []);

  // Viewport size from a ResizeObserver; camera x,y (top-left) is untouched on resize.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Non-passive wheel + Safari gesture listeners (React's onWheel is passive).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const pointOf = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      handlers.current.wheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: pointOf(e.clientX, e.clientY),
      });
    };
    let lastScale = 1;
    let lastPoint: { x: number; y: number } | null = null;
    const gesturePoint = (e: Event) => {
      const g = e as Event & { clientX?: number; clientY?: number };
      if (typeof g.clientX === 'number' && typeof g.clientY === 'number') {
        lastPoint = pointOf(g.clientX, g.clientY);
      }
      const rect = el.getBoundingClientRect();
      return lastPoint ?? { x: rect.width / HALF, y: rect.height / HALF };
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
      gesturePoint(e);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale;
      if (typeof scale !== 'number') return;
      const point = gesturePoint(e);
      handlers.current.zoomByFactor(point, scale / lastScale);
      lastScale = scale;
    };
    const onGestureEnd = (e: Event) => e.preventDefault();

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 on the board; prevents the browser's page zoom.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        handlers.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handlers.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        handlers.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const endPan = () => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    cam.endPan();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target !== viewportRef.current && e.target !== worldRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    panningRef.current = true;
    setPanning(true);
    cam.beginPan({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    cam.panMove({ x: e.clientX, y: e.clientY });
  };

  const gridSize = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at world multiples of GRID_SPACING_WORLD (the radial gradient is centred in its tile).
  const gridX = mod(-camera.x * camera.zoom - gridSize / HALF, gridSize);
  const gridY = mod(-camera.y * camera.zoom - gridSize / HALF, gridSize);
  const viewportStyle: CSSProperties = {
    backgroundImage: `radial-gradient(circle, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${gridX}px ${gridY}px`,
    cursor: panning ? 'grabbing' : 'default',
  };

  return (
    <div className="board-root">
      <div
        ref={viewportRef}
        className="board-viewport"
        data-testid="board-viewport"
        data-state={panning ? 'panning' : 'idle'}
        style={viewportStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
      >
        <div
          ref={worldRef}
          className="board-world"
          data-testid="board-world"
          style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
        >
          <div
            className="origin-marker"
            data-testid="origin-marker"
            style={{ width: MARKER_SIZE_WORLD, height: MARKER_SIZE_WORLD }}
          />
          {children}
        </div>
      </div>
      <NavigationHint visible={!cam.hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
    </div>
  );
}
