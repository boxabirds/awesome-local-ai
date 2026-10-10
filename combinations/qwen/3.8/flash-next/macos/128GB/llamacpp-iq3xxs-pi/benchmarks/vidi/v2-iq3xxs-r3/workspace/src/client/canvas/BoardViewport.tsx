import { useEffect, useRef, useState } from 'react';
import type {
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  WHEEL_LINE_DELTA_PX,
  WHEEL_PAGE_DELTA_PX,
} from '../../shared/config';
import type { Point } from './camera';
import { screenToWorld } from './camera';
import { useBoard } from './CameraProvider';
import type { BoardController } from './CameraProvider';

/** `WheelEvent.deltaMode` constants (WheelEvent.DOM_DELTA_*). */
const DELTA_MODE_PIXELS = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Attributes/markers used by tests. */
const PAN_SURFACE_ATTRIBUTE = 'data-pan-surface';

const ZOOM_IN_KEYS = ['=', '+'];
const ZOOM_OUT_KEYS = ['-', '_'];
const RESET_KEYS = ['0'];

/** Safari's pinch gestures arrive as `gesture*` events, which DOM lib omits. */
interface GestureEventLike extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

function deltaToPixels(delta: number, deltaMode: number): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return delta * WHEEL_LINE_DELTA_PX;
    case DELTA_MODE_PAGE:
      return delta * WHEEL_PAGE_DELTA_PX;
    case DELTA_MODE_PIXELS:
    default:
      return delta;
  }
}

/** Positive remainder, so the grid background offset stays small and finite. */
function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function isPanSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute(PAN_SURFACE_ATTRIBUTE);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function boardPoint(element: HTMLElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export interface BoardViewportProps {
  children?: ReactNode;
  /** A press-release on empty board space without panning (sticky.select). */
  onEmptySpaceClick?(): void;
  /** A double-click on empty board space, point in world coordinates
   *  (sticky.create_dblclick; a double-click on an object never gets here). */
  onEmptySpaceDoubleClick?(world: Point): void;
}

/**
 * The board's input surface: dot grid, world layer and the pointer/wheel/
 * gesture/keyboard handling that navigates it.
 *
 * Children are rendered in world coordinates inside the world layer, which is
 * `pointer-events: none` so a drag always starts on empty board space; object
 * stories re-enable pointer events on their own elements and stop propagation.
 */
export function BoardViewport({
  children,
  onEmptySpaceClick,
  onEmptySpaceDoubleClick,
}: BoardViewportProps): JSX.Element {
  const board = useBoard();
  const surfaceRef = useRef<HTMLDivElement>(null);
  /** Latest handlers, so the native listeners are attached only once. */
  const boardRef = useRef<BoardController>(board);
  const panPointerIdRef = useRef<number | null>(null);
  const gestureScaleRef = useRef<number | null>(null);
  /** Screen distance travelled by the current press, to tell pan from click. */
  const panDistanceRef = useRef(0);
  const panLastRef = useRef<Point | null>(null);
  const [panning, setPanning] = useState(false);

  /** Latest callbacks, so nothing needs re-attaching when they change. */
  const callbacksRef = useRef({ onEmptySpaceClick, onEmptySpaceDoubleClick });
  callbacksRef.current = { onEmptySpaceClick, onEmptySpaceDoubleClick };

  useEffect(() => {
    boardRef.current = board;
  });

  // Wheel and Safari gestures: attached natively so they can be non-passive
  // (React's onWheel is passive) and always cancel the browser default over
  // the board, which keeps page zoom and page scroll out of the way.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      boardRef.current.wheel({
        deltaX: deltaToPixels(event.deltaX, event.deltaMode),
        deltaY: deltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta,
        point: boardPoint(surface, event.clientX, event.clientY),
      });
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = (event as GestureEventLike).scale || 1;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = gesture.scale || 1;
      const previous = gestureScaleRef.current ?? scale;
      gestureScaleRef.current = scale;
      if (previous === scale) return;
      boardRef.current.zoomAt(boardPoint(surface, gesture.clientX, gesture.clientY), scale / previous);
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = null;
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('gesturestart', onGestureStart);
    surface.addEventListener('gesturechange', onGestureChange);
    surface.addEventListener('gestureend', onGestureEnd);
    return () => {
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('gesturestart', onGestureStart);
      surface.removeEventListener('gesturechange', onGestureChange);
      surface.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 would zoom the whole page, so the board owns them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key;
      if (ZOOM_IN_KEYS.includes(key)) {
        event.preventDefault();
        boardRef.current.zoomStep('in');
      } else if (ZOOM_OUT_KEYS.includes(key)) {
        event.preventDefault();
        boardRef.current.zoomStep('out');
      } else if (RESET_KEYS.includes(key)) {
        event.preventDefault();
        boardRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (event.button !== 0) return;
    if (!isPanSurface(event.target)) return;
    panPointerIdRef.current = event.pointerId;
    panDistanceRef.current = 0;
    panLastRef.current = boardPoint(surface, event.clientX, event.clientY);
    if (typeof surface.setPointerCapture === 'function') {
      surface.setPointerCapture(event.pointerId);
    }
    boardRef.current.beginPan(boardPoint(surface, event.clientX, event.clientY));
    setPanning(true);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (panPointerIdRef.current !== event.pointerId) return;
    const point = boardPoint(surface, event.clientX, event.clientY);
    const last = panLastRef.current;
    if (last) panDistanceRef.current += Math.abs(point.x - last.x) + Math.abs(point.y - last.y);
    panLastRef.current = point;
    boardRef.current.panMove(point);
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>, released: boolean): void => {
    if (panPointerIdRef.current !== event.pointerId) return;
    panPointerIdRef.current = null;
    panLastRef.current = null;
    const surface = surfaceRef.current;
    if (surface && typeof surface.releasePointerCapture === 'function' && surface.hasPointerCapture?.(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
    boardRef.current.endPan();
    setPanning(false);
    // A press on empty space that never became a pan is a click: it clears
    // the selection (sticky.select); a pan keeps it.
    if (released && panDistanceRef.current < DRAG_THRESHOLD_PX) {
      callbacksRef.current.onEmptySpaceClick?.();
    }
    panDistanceRef.current = 0;
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // Only empty board space creates notes; objects stop propagation.
    if (!isPanSurface(event.target)) return;
    const point = boardPoint(surface, event.clientX, event.clientY);
    callbacksRef.current.onEmptySpaceDoubleClick?.(
      screenToWorld(boardRef.current.camera, point),
    );
  };

  const { camera } = board;
  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at world multiples of the spacing, so their screen offset is the
  // camera's screen position modulo the spacing.
  const gridOffsetX = mod(-camera.x * camera.zoom, spacingPx);
  const gridOffsetY = mod(-camera.y * camera.zoom, spacingPx);

  return (
    <div
      ref={surfaceRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-pan-surface=""
      data-panning={panning ? 'true' : 'false'}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={(event) => endPan(event, true)}
      onPointerCancel={(event) => endPan(event, false)}
      onLostPointerCapture={(event) => endPan(event, false)}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="board-grid"
        data-testid="board-grid"
        data-pan-surface=""
        style={{
          backgroundSize: `${spacingPx}px ${spacingPx}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        }}
      />
      <div
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {import.meta.env.MODE === 'test' ? (
          <div
            className="test-marker-far"
            data-testid="test-marker-far"
            aria-hidden="true"
            style={{
              left: `${UNBOUNDED_PAN_TESTED_EXTENT}px`,
              top: `${UNBOUNDED_PAN_TESTED_EXTENT}px`,
            }}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}
