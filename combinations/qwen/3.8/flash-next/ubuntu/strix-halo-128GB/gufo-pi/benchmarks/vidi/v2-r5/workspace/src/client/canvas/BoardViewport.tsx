import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  GRID_DOT_RADIUS,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE,
  WHEEL_PIXELS_PER_LINE,
  WHEEL_PIXELS_PER_PAGE,
} from '../../shared/config';
import type { Camera, Point } from './camera';
import { screenToWorld } from './camera';
import type { CameraHandlers } from './useCamera';
import { DRAG_THRESHOLD_PX } from '../../shared/config';

export interface BoardViewportProps {
  /** Current camera; drives the dot grid and the world layer transform. */
  camera: Camera;
  /** Navigation handlers from `useCamera`. */
  handlers: CameraHandlers;
  /** Board content (sticky notes from story 2) rendered in world coordinates. */
  children?: ReactNode;
  /**
   * A double-click on empty board space, with the click converted to world coordinates.
   * The click did not land on an object: a double-click on a note is handled by the note.
   */
  onCreateSticky?(world: Point): void;
  /** A press on empty board space without dragging: clears the selection. */
  onClearSelection?(): void;
}

/** Safari trackpad gestures (`gesturestart` / `gesturechange` / `gestureend`). */
interface GestureLike extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Wheel deltaMode values (https://www.w3.org/TR/uievents/#ref-for-dom-wheelevent-deltamode). */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

const toPixels = (delta: number, deltaMode: number): number => {
  if (deltaMode === DELTA_MODE_LINE) return delta * WHEEL_PIXELS_PER_LINE;
  if (deltaMode === DELTA_MODE_PAGE) return delta * WHEEL_PIXELS_PER_PAGE;
  return delta;
};

const mod = (value: number, period: number): number =>
  period > 0 ? ((value % period) + period) % period : 0;

export function BoardViewport({
  camera,
  handlers,
  children,
  onCreateSticky,
  onClearSelection,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  // Keep the latest handlers without re-subscribing the native listeners every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  /** Only the empty board (viewport or world layer itself) starts a pan. */
  const isBoardSurface = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false;
    return (
      target === viewportRef.current ||
      target === worldRef.current ||
      (target instanceof HTMLElement && target.dataset.boardSurface === 'true')
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch screens are out of scope for story 1.
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    if (!isBoardSurface(event.target)) return;

    pointerIdRef.current = event.pointerId;
    pressRef.current = { x: event.clientX, y: event.clientY, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort (unsupported in some test environments).
    }
    setPanning(true);
    handlersRef.current.beginPan({ x: event.clientX, y: event.clientY });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const press = pressRef.current;
    if (press && !press.moved) {
      const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      // A pan that actually moved is not a click: it must not clear the selection.
      if (distance >= DRAG_THRESHOLD_PX) press.moved = true;
    }
    handlersRef.current.panMove({ x: event.clientX, y: event.clientY });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    setPanning(false);
    // Whatever the camera was at the moment of interruption is kept.
    handlersRef.current.endPan();
    const press = pressRef.current;
    pressRef.current = null;
    // A press on empty board space that never dragged is a click: clear the selection.
    if (press && !press.moved && onClearSelection) onClearSelection();
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onCreateSticky) return;
    // Only empty board space creates; a double-click on a note is handled by the note.
    if (!isBoardSurface(event.target)) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    const point: Point = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
    onCreateSticky(screenToWorld(cameraRef.current, point));
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      // The board owns every wheel over it: no page scroll, no browser page zoom.
      event.preventDefault();
      handlersRef.current.wheel({
        deltaX: toPixels(event.deltaX, event.deltaMode),
        deltaY: toPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX, y: event.clientY },
      });
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      handlersRef.current.beginGesture();
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureLike;
      handlersRef.current.gesture({
        scale: gesture.scale,
        point: { x: gesture.clientX, y: gesture.clientY },
      });
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      handlersRef.current.endGesture();
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart, { passive: false });
    element.addEventListener('gesturechange', onGestureChange, { passive: false });
    element.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case '=':
        case '+':
          // Stop the browser zooming the page; zoom the board one step instead.
          event.preventDefault();
          handlersRef.current.zoomStep('in');
          break;
        case '-':
        case '_':
          event.preventDefault();
          handlersRef.current.zoomStep('out');
          break;
        case '0':
          event.preventDefault();
          handlersRef.current.reset();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  const dotAlpha = Math.min(1, Math.max(0.2, spacingPx / GRID_SPACING_WORLD));
  const viewportStyle: CSSProperties = {
    backgroundImage: `radial-gradient(circle at 50% 50%, rgba(160, 168, 180, ${dotAlpha.toFixed(
      3,
    )}) ${GRID_DOT_RADIUS}px, transparent ${GRID_DOT_RADIUS}px)`,
    backgroundSize: `${spacingPx}px ${spacingPx}px`,
    backgroundPosition: `${mod(-camera.x * camera.zoom, spacingPx)}px ${mod(
      -camera.y * camera.zoom,
      spacingPx,
    )}px`,
  };

  const markerSize = ORIGIN_MARKER_SIZE / camera.zoom;

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      style={viewportStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={worldRef}
        className="board-world"
        data-testid="world-layer"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        <div
          className="origin-marker"
          data-testid="origin-marker"
          style={{
            width: `${markerSize}px`,
            height: `${markerSize}px`,
            left: `${-markerSize / 2}px`,
            top: `${-markerSize / 2}px`,
          }}
        />
        {children}
      </div>
    </div>
  );
}
