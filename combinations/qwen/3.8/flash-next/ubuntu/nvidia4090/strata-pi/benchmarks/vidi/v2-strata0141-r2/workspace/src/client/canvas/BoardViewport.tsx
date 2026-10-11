import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { DRAG_THRESHOLD_PX, GRID_DOT_RADIUS_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { screenToWorld, worldToScreen } from './camera';
import { useBoardController, wheelDeltaToPixels, type CameraController, type Point } from './useCamera';

export interface BoardViewportProps {
  /** Board content in world coordinates (sticky notes and later objects). */
  children?: ReactNode;
  /**
   * Double-click on empty board space: the world point that was clicked.
   * The caller creates the object there and starts interacting with it.
   */
  onCreateAt?: (world: Point) => void;
  /** A click on empty board space that did not become a pan. */
  onEmptyClick?: () => void;
}

interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly initialScale: number;
  readonly clientX: number;
  readonly clientY: number;
}

const GESTURE_START = 'gesturestart';
const GESTURE_CHANGE = 'gesturechange';
const GESTURE_END = 'gestureend';

function mod(value: number, period: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(period) || period <= 0) {
    return 0;
  }
  return ((value % period) + period) % period;
}

function elementOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/** Overlays (zoom controls, hint) keep their own gestures for the browser. */
function isOverlay(target: EventTarget | null): boolean {
  return elementOf(target)?.closest('[data-vidi6-overlay]') != null;
}

/** A drag only starts on the board surface itself, never on board objects or overlays. */
function isBoardSurface(target: EventTarget | null): boolean {
  const el = elementOf(target);
  if (!el || isOverlay(el)) {
    return false;
  }
  return el.getAttribute('data-board-surface') !== null;
}

/**
 * The board surface: dot grid that moves with the board, the world layer, and
 * all navigation input (drag, wheel/trackpad scroll, pinch, Safari gesture).
 * The wheel listener is attached `passive: false` so board gestures never zoom
 * or scroll the page.
 */
export function BoardViewport({ children, onCreateAt, onEmptyClick }: BoardViewportProps) {
  const controller = useBoardController();
  const controllerRef = useRef<CameraController>(controller);
  controllerRef.current = controller;
  const callbacksRef = useRef({ onCreateAt, onEmptyClick });
  callbacksRef.current = { onCreateAt, onEmptyClick };

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    last: Point;
    start: Point;
    moved: boolean;
  } | null>(null);

  const localPoint = (clientX: number, clientY: number): Point => {
    const el = surfaceRef.current;
    if (!el) {
      return { x: clientX, y: clientY };
    }
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) {
      return;
    }
    const api = () => controllerRef.current;

    const onWheel = (event: WheelEvent): void => {
      if (isOverlay(event.target)) {
        // Over the zoom controls or hint: leave the event to the browser.
        return;
      }
      event.preventDefault();
      api().wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY),
      });
    };

    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      api().gesture(localPoint(gesture.clientX, gesture.clientY), 1);
    };

    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      api().gesture(
        localPoint(gesture.clientX, gesture.clientY),
        gesture.scale,
        gesture.initialScale,
      );
    };

    const onGestureEnd = (): void => {
      api().endGesture();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        if (!event.altKey) {
          if (event.code === 'Equal' || event.key === '=' || event.key === '+') {
            event.preventDefault();
            api().zoomStep('in');
            return;
          }
          if (event.code === 'Minus' || event.key === '-' || event.key === '_') {
            event.preventDefault();
            api().zoomStep('out');
            return;
          }
          if (event.code === 'Digit0' || event.code === 'Numpad0' || event.key === '0') {
            event.preventDefault();
            api().reset();
            return;
          }
        }
        return;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener(GESTURE_START, onGestureStart, { passive: false });
    el.addEventListener(GESTURE_CHANGE, onGestureChange, { passive: false });
    el.addEventListener(GESTURE_END, onGestureEnd);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener(GESTURE_START, onGestureStart);
      el.removeEventListener(GESTURE_CHANGE, onGestureChange);
      el.removeEventListener(GESTURE_END, onGestureEnd);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !isBoardSurface(event.target)) {
      return;
    }
    const point = localPoint(event.clientX, event.clientY);
    dragRef.current = { pointerId: event.pointerId, last: point, start: point, moved: false };
    const el = event.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is an optimisation; dragging works without it.
      }
    }
    controllerRef.current.beginPan(point);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const point = localPoint(event.clientX, event.clientY);
    if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
    controllerRef.current.panMove(point);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    controllerRef.current.endPan();
    if (!drag.moved) {
      // A click on empty board space deselects whatever was selected.
      callbacksRef.current.onEmptyClick?.();
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Only empty board space creates objects; notes handle their own double-click.
    if (!isBoardSurface(event.target) || !callbacksRef.current.onCreateAt) {
      return;
    }
    event.stopPropagation();
    const camera = controllerRef.current.camera;
    callbacksRef.current.onCreateAt(screenToWorld(camera, localPoint(event.clientX, event.clientY)));
  };

  const camera = controller.camera;
  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = mod(-camera.x * camera.zoom, spacingPx);
  const gridOffsetY = mod(-camera.y * camera.zoom, spacingPx);
  const origin = worldToScreen(camera, { x: 0, y: 0 });

  const surfaceStyle = {
    '--grid-size': `${spacingPx}px`,
    '--grid-offset-x': `${gridOffsetX}px`,
    '--grid-offset-y': `${gridOffsetY}px`,
    '--grid-dot-radius': `${GRID_DOT_RADIUS_PX}px`,
  } as CSSProperties;

  const worldStyle = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  } satisfies CSSProperties;

  return (
    <div
      ref={surfaceRef}
      className="board-viewport"
      data-board-surface="viewport"
      data-testid="board-viewport"
      data-panning={controller.isPanning ? 'true' : 'false'}
      data-zoom={camera.zoom}
      aria-label="Board"
      style={surfaceStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="board-grid"
        data-board-surface="grid"
        data-testid="board-grid"
        data-grid-size={spacingPx}
        data-grid-offset-x={gridOffsetX}
        data-grid-offset-y={gridOffsetY}
      />
      <div
        className="board-world"
        data-board-surface="world"
        data-testid="board-world"
        data-transform={worldStyle.transform}
        style={worldStyle}
      >
        {children}
      </div>
      <div
        className="board-origin-marker"
        data-testid="origin-marker"
        data-x={origin.x}
        data-y={origin.y}
        aria-hidden="true"
        style={{ transform: `translate3d(${origin.x}px, ${origin.y}px, 0)` }}
      />
    </div>
  );
}
