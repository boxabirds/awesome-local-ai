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
  /** Click (down + up, no movement) on empty board space. */
  onEmptyClick?: () => void;
  /** Double-click on empty board space, at the screen point of the click. */
  onCreateStickyAt?: (screenPoint: Point) => void;
  /** Text tool active (board.text_tool): the cursor is 'text'. */
  textToolActive?: boolean;
  /** Text tool: click (down + up, no movement) anywhere, including over
   *  objects, creates a text object at the screen point. */
  onCreateTextAt?: (screenPoint: Point) => void;
  /** Sticky tool active (sticky.tool_ui): the cursor is crosshair and a
   *  click anywhere (no movement) creates a sticky at the screen point. */
  stickyToolActive?: boolean;
  /** Marquee selection: Shift+pointerdown on empty board space. */
  onMarqueeBegin?: (screenPoint: Point) => void;
  onMarqueeMove?: (screenPoint: Point) => void;
  onMarqueeEnd?: () => void;
  onMarqueeCancel?: () => void;
  /** Screen-space overlays (the Pen tool, story 11): rendered inside the
   *  viewport so wheel/gesture events still reach the camera handlers. */
  screenOverlays?: ReactNode;
}

/** Positive modulo in [0, m). */
function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

export function BoardViewport({
  children,
  cam,
  onEmptyClick,
  onCreateStickyAt,
  textToolActive = false,
  onCreateTextAt,
  stickyToolActive = false,
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  screenOverlays,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const downPointRef = useRef<Point | null>(null);
  const marqueeActiveRef = useRef(false);
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

  // Keyboard shortcuts: Ctrl/Cmd + = / - / 0 (preventDefault stops page
  // zoom), Escape cancels an in-flight marquee.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        onMarqueeCancel?.();
        return;
      }
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
  }, [zoomStepApi, resetApi, onMarqueeCancel]);

  const pointFromEvent = (event: { clientX: number; clientY: number }): Point => {
    const el = viewportRef.current;
    if (el === null) return { x: event.clientX, y: event.clientY };
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (el === null) return;
    if (textToolActive || stickyToolActive) {
      // Placement tools: remember the down point; a click (no movement)
      // creates the object anywhere, including over board objects.
      downPointRef.current = pointFromEvent(event);
      return;
    }
    // Drag starts only on the viewport/grid itself; board objects (later
    // stories) stop propagation from within the world layer.
    if (event.target !== el) return;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture unsupported (e.g. jsdom) — drag still works.
    }
    downPointRef.current = pointFromEvent(event);
    if (event.shiftKey && onMarqueeBegin !== undefined) {
      // Shift+drag on empty space starts a marquee instead of a pan.
      marqueeActiveRef.current = true;
      onMarqueeBegin(pointFromEvent(event));
    } else {
      cam.beginPan(pointFromEvent(event));
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeActiveRef.current) {
      onMarqueeMove?.(pointFromEvent(event));
      return;
    }
    cam.panMove(pointFromEvent(event));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (textToolActive || stickyToolActive) {
      const down = downPointRef.current;
      downPointRef.current = null;
      // A click (down + up without movement) creates the object.
      const up = pointFromEvent(event);
      if (down !== null && down.x === up.x && down.y === up.y) {
        if (textToolActive) onCreateTextAt?.(up);
        else onCreateStickyAt?.(up);
      }
      return;
    }
    if (marqueeActiveRef.current) {
      marqueeActiveRef.current = false;
      downPointRef.current = null;
      onMarqueeEnd?.();
      return;
    }
    const el = viewportRef.current;
    cam.endPan();
    // A click on empty space (down + up without movement) clears selection.
    if (el !== null && event.target === el) {
      const down = downPointRef.current;
      const up = pointFromEvent(event);
      if (down !== null && down.x === up.x && down.y === up.y) {
        onEmptyClick?.();
      }
    }
    downPointRef.current = null;
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeActiveRef.current) {
      marqueeActiveRef.current = false;
      downPointRef.current = null;
      onMarqueeCancel?.();
      return;
    }
    onPointerUp(event);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    // Double-click creates a note only on the viewport/grid itself; double
    // clicks on notes are handled by the notes (they stop propagation).
    // Suppressed while the sticky tool is active: every click already
    // creates one, so a double-click would triple it.
    if (el === null || event.target !== el || stickyToolActive) return;
    onCreateStickyAt?.(pointFromEvent(event));
  };

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
        cursor: textToolActive ? 'text' : stickyToolActive ? 'crosshair' : panning ? 'grabbing' : 'grab',
        backgroundImage: `radial-gradient(circle, ${DOT_COLOR} ${DOT_RADIUS_PX}px, transparent ${DOT_RADIUS_PX + 1}px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${backgroundPositionX}px ${backgroundPositionY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
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
      {screenOverlays}
    </div>
  );
}
