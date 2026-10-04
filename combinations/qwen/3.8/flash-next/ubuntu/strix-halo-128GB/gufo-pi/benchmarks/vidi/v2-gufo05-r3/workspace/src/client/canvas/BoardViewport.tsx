import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { worldToScreen, type Size } from './camera';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { installTestHook } from './testHooks';
import { GRID_SPACING_WORLD } from '../../shared/config';

/** Pixels per LINE deltaMode unit (mouse wheel notch). */
const LINE_HEIGHT_PX = 16;

function mod(a: number, n: number): number {
  if (n === 0) return 0;
  return ((a % n) + n) % n;
}

function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[data-zoom-controls]') != null
  );
}

export interface BoardViewportProps {
  children?: React.ReactNode;
}

/**
 * The input surface for the infinite board. Owns viewport sizing, the camera,
 * all navigation gestures (drag, wheel, Safari gesture, keyboard) and the
 * overlay controls + first-use hint. Renders the dot grid and the world layer.
 */
export function BoardViewport(props: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const viewportRef = useRef(viewport);
  const camera = useCamera(viewport);
  const apiRef = useRef(camera);
  apiRef.current = camera;

  const {
    camera: cam,
    hasNavigated,
    panning,
    zoomPercent,
    canZoomIn,
    canZoomOut,
    beginPan,
    panMove,
    endPan,
  } = camera;

  // --- Viewport measurement (ResizeObserver) --------------------------------
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      if (next.width !== viewportRef.current.width || next.height !== viewportRef.current.height) {
        viewportRef.current = next;
        setViewport(next);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pointFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- Wheel (non-passive) --------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Wheel over the zoom controls must not move the board, and must not
      // suppress the browser default there (TC-30).
      if (isControlTarget(e.target)) return;
      e.preventDefault();
      const factor =
        e.deltaMode === 1
          ? LINE_HEIGHT_PX
          : e.deltaMode === 2
            ? viewportRef.current.height || 1
            : 1;
      apiRef.current.wheel({
        deltaX: e.deltaX * factor,
        deltaY: e.deltaY * factor,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: pointFromEvent(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pointFromEvent]);

  // --- Safari gesture (pinch) ----------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const onStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale = ge.scale ?? 1;
      const ratio = scale / (lastScale || 1);
      lastScale = scale;
      apiRef.current.zoomAtPoint(pointFromEvent(ge.clientX ?? 0, ge.clientY ?? 0), ratio);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    el.addEventListener('gesturestart', onStart as EventListener);
    el.addEventListener('gesturechange', onChange as EventListener);
    el.addEventListener('gestureend', onEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onStart as EventListener);
      el.removeEventListener('gesturechange', onChange as EventListener);
      el.removeEventListener('gestureend', onEnd as EventListener);
    };
  }, [pointFromEvent]);

  // --- Keyboard shortcuts (window) -----------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        apiRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- Test hook ------------------------------------------------------------
  useEffect(() => {
    installTestHook((next) => apiRef.current.setCamera(next));
  }, []);

  // --- Pointer drag ---------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isControlTarget(e.target)) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* not supported (e.g. jsdom) */
    }
    beginPan(pointFromEvent(e.clientX, e.clientY));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panning) return;
    panMove(pointFromEvent(e.clientX, e.clientY));
  };
  const onPointerUp = () => endPan();
  const onPointerCancel = () => endPan();
  const onLostPointerCapture = () => endPan();

  // --- Derived styles -------------------------------------------------------
  const size = GRID_SPACING_WORLD * cam.zoom;
  const offsetX = mod(-cam.x * cam.zoom, size);
  const offsetY = mod(-cam.y * cam.zoom, size);
  const origin = worldToScreen(cam, { x: 0, y: 0 });

  return (
    <div
      ref={containerRef}
      className="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      style={{ cursor: panning ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
    >
      {/* Dot grid surface: pointer target for panning. */}
      <div
        className="board-surface"
        data-board-surface=""
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, #c3c9d6 1.5px, transparent 1.5px)',
          backgroundSize: `${size}px ${size}px`,
          backgroundPosition: `${offsetX}px ${offsetY}px`,
          backgroundRepeat: 'repeat',
        }}
      />

      {/* World layer: children are positioned in world coordinates. */}
      <div
        className="world-layer"
        style={{
          transform: `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {props.children}
      </div>

      {/* Origin marker: stable pixel target for tests, world (0,0). */}
      <div
        className="origin-marker"
        data-origin-marker=""
        aria-hidden="true"
        style={{ left: `${origin.x}px`, top: `${origin.y}px` }}
      />

      <ZoomControls
        zoomPercent={zoomPercent}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={camera.reset}
      />

      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
