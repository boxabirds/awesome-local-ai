import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CameraApi } from './useCamera';
import { GRID_SPACING_WORLD } from '../../shared/config';

/** Pixel sizes used to convert wheel deltaMode LINE/PAGE values to pixels. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 100;
/** WheelEvent deltaMode values (named locally: jsdom does not expose the statics). */
const DELTA_MODE_PIXEL = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

export interface BoardViewportProps {
  children?: ReactNode;
  /** Camera API from `useCamera`; App owns the single camera instance. */
  api: CameraApi;
}

/**
 * Full-window input surface for the board: dot grid background, world layer
 * (CSS transform) and the origin marker.
 *
 * Drag starts only on empty board space (the viewport or world layer
 * element); later object stories can stopPropagation on their elements.
 */
export function BoardViewport({ children, api }: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const apiRef = useRef(api);
  apiRef.current = api;

  const toPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // ----- pointer drag (Idle -> Panning -> Idle) -----

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Node;
    if (target !== viewportRef.current && target !== worldRef.current) return;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
    panningRef.current = true;
    setPanning(true);
    apiRef.current.beginPan(toPoint(e.clientX, e.clientY));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panningRef.current) return;
    apiRef.current.panMove(toPoint(e.clientX, e.clientY));
  };

  const stopPan = (e?: React.PointerEvent) => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    if (e?.pointerId !== undefined) {
      try {
        viewportRef.current?.releasePointerCapture?.(e.pointerId);
      } catch {
        // capture may already be gone; the drag ends either way
      }
    }
    apiRef.current.endPan();
  };

  // ----- wheel (non-passive so the page never scrolls/zooms) -----

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Always over the board: suppress the browser default (page scroll/zoom).
      e.preventDefault();
      let { deltaX, deltaY } = e;
      if (e.deltaMode === DELTA_MODE_LINE) {
        deltaX *= WHEEL_LINE_PX;
        deltaY *= WHEEL_LINE_PX;
      } else if (e.deltaMode === DELTA_MODE_PAGE) {
        deltaX *= WHEEL_PAGE_PX;
        deltaY *= WHEEL_PAGE_PX;
      }
      apiRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toPoint(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Safari pinch (gesture events) -----

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale = gesture.scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
      const ratio = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;
      if (gesture.clientX === undefined || gesture.clientY === undefined) return;
      apiRef.current.zoomAtPoint(toPoint(gesture.clientX, gesture.clientY), ratio);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- keyboard: Ctrl/Cmd + = / - / 0 (window level; stops page zoom) -----

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
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

  // ----- rendering -----

  const { camera } = api;
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at world multiples of GRID_SPACING_WORLD; anchoring the tile at
  // -camera.xy*zoom keeps the grid attached to the board under pan and zoom.
  const bgPosX = -camera.x * camera.zoom;
  const bgPosY = -camera.y * camera.zoom;

  return (
    <div
      ref={viewportRef}
      className={panning ? 'vidi6-viewport vidi6-viewport--panning' : 'vidi6-viewport'}
      style={{
        backgroundImage: 'radial-gradient(circle, #c7cdd6 1.1px, transparent 1.1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgPosX}px ${bgPosY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => stopPan(e)}
      onPointerCancel={(e) => stopPan(e)}
      onLostPointerCapture={() => stopPan()}
    >
      <div
        ref={worldRef}
        className="vidi6-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        <OriginMarker />
        {children}
      </div>
    </div>
  );
}

/** Small crosshair at world (0,0): the board's starting point, also the e2e target. */
function OriginMarker() {
  return (
    <div className="vidi6-origin-marker" data-testid="origin-marker" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <line x1="8" y1="0" x2="8" y2="16" stroke="#9aa4b2" strokeWidth="1" />
        <line x1="0" y1="8" x2="16" y2="8" stroke="#9aa4b2" strokeWidth="1" />
      </svg>
    </div>
  );
}
