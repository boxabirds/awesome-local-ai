// Board viewport: the input surface (drag, wheel, Safari gesture, keyboard)
// and the rendered board (dot grid + world layer, see spec: viewport.input).

import { useEffect, useRef, type ReactNode } from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_DELTA_PIXELS,
  WHEEL_PAGE_DELTA_PIXELS,
} from '../../shared/config';
import type { Point } from './camera';
import type { CameraApi } from './useCamera';

// WheelEvent.deltaMode constants (DOM spec).
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

// Dot grid appearance.
const DOT_COLOR = '#c9ced6';
const DOT_RADIUS_PX = 1;

export interface BoardViewportProps {
  children?: ReactNode;
  /** Shared camera hook result (see structure diagram: all components wire to it). */
  cam: CameraApi;
}

/** Positive modulo in [0, m). */
function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

export function BoardViewport({ children, cam }: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { wheel: wheelApi, gestureStart, gestureChange, zoomStep: zoomStepApi, reset: resetApi } = cam;

  // Non-passive wheel listener: React's onWheel is passive and cannot
  // preventDefault, which is required to stop page zoom (TC-31 / PRD zoom.no_page_zoom).
  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) return;
    const toPoint = (clientX: number, clientY: number): Point => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      let deltaX = event.deltaX;
      let deltaY = event.deltaY;
      if (event.deltaMode === DOM_DELTA_LINE) {
        deltaX *= WHEEL_LINE_DELTA_PIXELS;
        deltaY *= WHEEL_LINE_DELTA_PIXELS;
      } else if (event.deltaMode === DOM_DELTA_PAGE) {
        deltaX *= WHEEL_PAGE_DELTA_PIXELS;
        deltaY *= WHEEL_PAGE_DELTA_PIXELS;
      }
      wheelApi({
        deltaX,
        deltaY,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: toPoint(event.clientX, event.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheelApi]);

  // Safari trackpad pinch (GestureEvent).
  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) return;
    const toPoint = (clientX: number, clientY: number): Point => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const onStart = (event: Event) => {
      event.preventDefault();
      gestureStart();
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (
        typeof gesture.scale === 'number' &&
        typeof gesture.clientX === 'number' &&
        typeof gesture.clientY === 'number'
      ) {
        gestureChange(gesture.scale, toPoint(gesture.clientX, gesture.clientY));
      }
    };
    el.addEventListener('gesturestart', onStart);
    el.addEventListener('gesturechange', onChange);
    return () => {
      el.removeEventListener('gesturestart', onStart);
      el.removeEventListener('gesturechange', onChange);
    };
  }, [gestureStart, gestureChange]);

  // Keyboard shortcuts: Ctrl/Cmd + = / - / 0 (preventDefault stops page zoom).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault();
          zoomStepApi('in');
          break;
        case '-':
        case '_':
          event.preventDefault();
          zoomStepApi('out');
          break;
        case '0':
          event.preventDefault();
          resetApi();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStepApi, resetApi]);

  const pointFromEvent = (event: { clientX: number; clientY: number }): Point => {
    const el = viewportRef.current;
    if (el === null) return { x: event.clientX, y: event.clientY };
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    // Drag starts only on the viewport/grid itself; board objects (later
    // stories) stop propagation from within the world layer.
    if (el === null || event.target !== el) return;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture unsupported (e.g. jsdom) — drag still works.
    }
    cam.beginPan(pointFromEvent(event));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    cam.panMove(pointFromEvent(event));
  };

  const endPan = () => cam.endPan();

  const { camera, panning } = cam;
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const backgroundPositionX = mod(-camera.x * camera.zoom, spacing);
  const backgroundPositionY = mod(-camera.y * camera.zoom, spacing);

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      className="board-viewport"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: panning ? 'grabbing' : 'grab',
        backgroundImage: `radial-gradient(circle, ${DOT_COLOR} ${DOT_RADIUS_PX}px, transparent ${DOT_RADIUS_PX + 1}px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${backgroundPositionX}px ${backgroundPositionY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
    >
      <div
        data-testid="board-world"
        className="board-world"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        <div data-testid="origin-marker" aria-hidden="true" className="origin-marker" />
        {children}
      </div>
    </div>
  );
}
