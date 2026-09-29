import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_PAGE_HEIGHT_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import type { CameraApi } from './useCamera';
import type { Point } from './camera';
import { DRAG_THRESHOLD_PX } from '../../shared/config';

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Camera state and input methods from `useCamera`. `App` owns the hook so the
   * zoom controls and the navigation hint share the same camera.
   */
  camera: CameraApi;
  /**
   * A press on empty board space that was released without dragging. Used to
   * clear the selection.
   */
  onEmptyClick?(point: Point): void;
  /**
   * A double-click on empty board space (not on a board object). Used to create
   * something at that point.
   */
  onEmptyDblClick?(point: Point): void;
}

/** `deltaMode` values from the WheelEvent spec. */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Convert a wheel delta in lines or pages into CSS pixels. */
export function wheelDeltaToPx(delta: number, deltaMode: number): number {
  if (deltaMode === DELTA_MODE_LINE) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === DELTA_MODE_PAGE) return delta * WHEEL_PAGE_HEIGHT_PX;
  return delta;
}

/** Safari's pinch gesture, reported as a cumulative scale factor. */
interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/**
 * The infinite board: an input surface with a dot grid that moves with the
 * camera, a world layer holding board content in world coordinates, and the
 * board's starting point marked with a crosshair.
 */
export function BoardViewport({
  children,
  camera: cameraApi,
  onEmptyClick,
  onEmptyDblClick,
}: BoardViewportProps) {
  const { camera } = cameraApi;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  /** Where the current press on the board started, to tell a click from a drag. */
  const pressRef = useRef<Point | null>(null);

  // The listeners below are attached natively (React's onWheel is passive) and
  // must survive re-renders, so they read the camera API through a ref.
  const apiRef = useRef(cameraApi);
  apiRef.current = cameraApi;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;

    const onWheel = (event: WheelEvent) => {
      // The board owns every wheel over itself: no page scroll and, with Ctrl or
      // Cmd held, no browser page zoom.
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      apiRef.current.wheel({
        deltaX: wheelDeltaToPx(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPx(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
    };

    let lastGestureScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      lastGestureScale = (event as GestureEventLike).scale ?? 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = gesture.scale ?? 1;
      const ratio = lastGestureScale > 0 ? scale / lastGestureScale : 1;
      lastGestureScale = scale;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const rect = element.getBoundingClientRect();
      apiRef.current.wheel({
        deltaX: 0,
        // Safari hands us a scale ratio; the hook takes the same shape as a
        // Ctrl/Cmd wheel, so convert it to the equivalent deltaY using
        // factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
        deltaY: -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: {
          x: (gesture.clientX ?? rect.width / 2) - rect.left,
          y: (gesture.clientY ?? rect.height / 2) - rect.top,
        },
      });
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
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

  /**
   * A drag starts only on the board surface itself (viewport, world layer), so
   * board objects added in later stories can keep drags for themselves.
   */
  const isBoardSurface = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && target.dataset.boardSurface === 'true';

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== null) return;
    if (!isBoardSurface(event.target)) return;
    const element = viewportRef.current;
    if (element) {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // No pointer capture (or the pointer already went away): the drag still
        // works for events that reach the viewport.
      }
    }
    activePointerRef.current = event.pointerId;
    pressRef.current = { x: event.clientX, y: event.clientY };
    setPanning(true);
    cameraApi.beginPan({ x: event.clientX, y: event.clientY });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    cameraApi.panMove({ x: event.clientX, y: event.clientY });
  };

  const handleDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    // pointerup, pointercancel and lostpointercapture all end the drag and leave
    // the board where it was at the moment of interruption.
    activePointerRef.current = null;
    const press = pressRef.current;
    pressRef.current = null;
    setPanning(false);
    cameraApi.endPan();
    // A press on empty space with no real travel is a click on the board, and a
    // click on the board clears the selection.
    const travelled =
      press === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (travelled <= DRAG_THRESHOLD_PX && isBoardSurface(event.target)) {
      onEmptyClick?.({ x: event.clientX, y: event.clientY });
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Only empty board space: a double-click on a note is handled by the note.
    if (!isBoardSurface(event.target)) return;
    onEmptyDblClick?.({ x: event.clientX, y: event.clientY });
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = mod(-camera.x * camera.zoom, spacing);
  const gridOffsetY = mod(-camera.y * camera.zoom, spacing);

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="viewport"
      data-board-surface="true"
      data-panning={panning ? 'true' : 'false'}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      style={{
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onLostPointerCapture={handleDragEnd}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="board-world"
        data-testid="world-layer"
        data-board-surface="true"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        <OriginMarker />
        {children}
      </div>
    </div>
  );
}

/**
 * Small crosshair at the board's starting point (world 0,0). Its own box is
 * empty, so its bounding rect is exactly the screen position of world 0,0 —
 * which makes it a stable target for the e2e pixel tests as well as a cue for
 * people who have panned away.
 */
function OriginMarker() {
  return (
    <div className="origin-marker" data-testid="origin-marker" data-board-surface="true" aria-hidden="true">
      <span className="origin-marker__arm origin-marker__arm--h" />
      <span className="origin-marker__arm origin-marker__arm--v" />
    </div>
  );
}
