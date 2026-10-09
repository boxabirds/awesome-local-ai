import {
  useEffect,
  useRef,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  WHEEL_PIXELS_PER_LINE,
  WHEEL_PIXELS_PER_PAGE,
} from '../../shared/config';
import type { Camera, Point } from './camera';
import { useCameraApi } from './useCamera';

const DOT_RADIUS_PX = 1.5;
const DOT_COLOUR = '#c7ccd6';
const ORIGIN_MARKER_SIZE_PX = 16;
const KEYBOARD_ZOOM_IN_KEYS = ['=', '+'];
const KEYBOARD_ZOOM_OUT_KEYS = ['-', '_'];
const KEYBOARD_RESET_KEYS = ['0'];
const WHEEL_LINE_MODE = 1;
const WHEEL_PAGE_MODE = 2;

/** World-space transform of the layer holding everything drawn on the board. */
export function worldLayerTransform(cam: Camera): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

function modulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Dot grid that scrolls and scales with the board (visible even on an empty board). */
export function gridBackground(cam: Camera): CSSProperties {
  const spacing = GRID_SPACING_WORLD * cam.zoom;
  return {
    backgroundImage: `radial-gradient(circle at center, ${DOT_COLOUR} ${DOT_RADIUS_PX}px, transparent ${
      DOT_RADIUS_PX + 0.5
    }px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${modulo(-cam.x * cam.zoom, spacing)}px ${modulo(
      -cam.y * cam.zoom,
      spacing,
    )}px`,
  };
}

function boardPoint(element: HTMLElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/** Wheel deltas arrive in pixels, lines or pages; the camera works in CSS pixels. */
function wheelPixels(deltaMode: number): number {
  if (deltaMode === WHEEL_LINE_MODE) return WHEEL_PIXELS_PER_LINE;
  if (deltaMode === WHEEL_PAGE_MODE) return WHEEL_PIXELS_PER_PAGE;
  return 1;
}

/** Safari's pinch gesture events, which are not in the standard lib types. */
interface GestureLike {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Double-click on empty board space (sticky.create_dblclick): the point is in screen
   * pixels inside the viewport; the caller turns it into world coordinates.
   */
  onCreateStickyAt?(point: Point): void;
  /** A click on empty board space that did not pan the board (sticky.select). */
  onEmptyClick?(): void;
}

/**
 * The input surface and rendering of the infinite board: pointer drag pans, plain
 * wheel scrolls, Ctrl/Cmd wheel and Safari gestures zoom around the pointer, and
 * Ctrl/Cmd + `=`, `-`, `0` step and reset. Every one of those is preventDefault-ed so
 * the browser never zooms or scrolls the page itself.
 */
export function BoardViewport({
  children,
  onCreateStickyAt,
  onEmptyClick,
}: BoardViewportProps): JSX.Element {
  const api = useCameraApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const gestureScaleRef = useRef(1);
  // Distinguishes a click on empty board space from a pan, so only the first one clears
  // the selection. `DRAG_THRESHOLD_PX` is the same threshold the notes use.
  const pressRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  const { camera, panning } = api;

  // Wheel must be non-passive (React's onWheel is passive) so page zoom/scroll is prevented.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const scale = wheelPixels(event.deltaMode);
      apiRef.current.wheel({
        deltaX: event.deltaX * scale,
        deltaY: event.deltaY * scale,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: boardPoint(element, event.clientX, event.clientY),
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });

    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      gestureScaleRef.current = (event as unknown as GestureLike).scale || 1;
    };
    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = event as unknown as GestureLike;
      const previous = gestureScaleRef.current || 1;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      apiRef.current.zoomAround(
        boardPoint(element, gesture.clientX, gesture.clientY),
        gesture.scale / previous,
      );
      gestureScaleRef.current = gesture.scale;
    };
    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
      gestureScaleRef.current = 1;
    };
    const gestureListeners: Array<[string, EventListener]> = [
      ['gesturestart', onGestureStart as EventListener],
      ['gesturechange', onGestureChange as EventListener],
      ['gestureend', onGestureEnd as EventListener],
    ];
    for (const [type, listener] of gestureListeners) {
      element.addEventListener(type, listener);
    }

    return () => {
      element.removeEventListener('wheel', onWheel);
      for (const [type, listener] of gestureListeners) {
        element.removeEventListener(type, listener);
      }
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 while the board is focused, prevented so page zoom is unaffected.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (KEYBOARD_ZOOM_IN_KEYS.includes(event.key)) {
        event.preventDefault();
        apiRef.current.zoomStep('in');
      } else if (KEYBOARD_ZOOM_OUT_KEYS.includes(event.key)) {
        event.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (KEYBOARD_RESET_KEYS.includes(event.key)) {
        event.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Touch navigation is out of scope; only mouse and pen pan by dragging.
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // Only empty board space starts a pan: objects stop propagation themselves.
    if (event.target !== event.currentTarget) return;
    const element = event.currentTarget;
    pointerIdRef.current = event.pointerId;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
    const point = boardPoint(element, event.clientX, event.clientY);
    pressRef.current = { x: point.x, y: point.y, dragged: false };
    api.beginPan(point);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    const element = event.currentTarget;
    const point = boardPoint(element, event.clientX, event.clientY);
    const press = pressRef.current;
    if (press && !press.dragged) {
      const dx = point.x - press.x;
      const dy = point.y - press.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) press.dragged = true;
    }
    api.panMove(point);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    const press = pressRef.current;
    pressRef.current = null;
    api.endPan();
    // A click on empty board space clears the selection; a pan leaves it alone.
    if (press && !press.dragged) onEmptyClick?.();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Only empty board space creates a note: a note stops the event itself (TC-35).
    if (event.target !== event.currentTarget) return;
    const element = event.currentTarget;
    onCreateStickyAt?.(boardPoint(element, event.clientX, event.clientY));
  };

  return (
    <div
      ref={viewportRef}
      className="vidi6-viewport"
      data-testid="viewport"
      data-state={panning ? 'panning' : 'idle'}
      style={gridBackground(camera)}
      aria-label="Board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={onDoubleClick}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
    >
      <div
        className="vidi6-world"
        data-testid="world-layer"
        style={{ transform: worldLayerTransform(camera) }}
      >
        <div
          className="vidi6-origin-marker"
          data-testid="origin-marker"
          aria-hidden="true"
          style={{ width: ORIGIN_MARKER_SIZE_PX, height: ORIGIN_MARKER_SIZE_PX }}
        />
        {children}
      </div>
    </div>
  );
}
