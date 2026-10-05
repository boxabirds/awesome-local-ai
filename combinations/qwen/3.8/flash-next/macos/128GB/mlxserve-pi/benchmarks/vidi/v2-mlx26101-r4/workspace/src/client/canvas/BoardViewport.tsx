import { useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { cameraStore } from './cameraStore';
import type { Point } from './camera';
import { screenToWorld } from './camera';
import { useCamera, useViewportSize, wheelDeltaToPixels } from './useCamera';

/** Only the primary pointer button pans; other buttons stay available to objects. */
const PRIMARY_MOUSE_BUTTON = 0;

/** Safari's non-standard pinch events (`gesturestart`/`change`/`end`). */
interface SafariGestureEvent extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** Modulo that always returns a value in `[0, period)`; 0 keeps the grid sane. */
function mod(value: number, period: number): number {
  if (!Number.isFinite(value) || !(period > 0)) return 0;
  return ((value % period) + period) % period;
}

function gestureScale(event: SafariGestureEvent): number {
  return typeof event.scale === 'number' ? event.scale : Number.NaN;
}

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Double-click on empty board space, with the world point that was clicked:
   * this is where a new sticky note is put down. Without it the board only pans
   * and zooms, exactly as in story 1.
   */
  onCreateAt?(world: Point): void;
  /**
   * A click on empty board space that did not pan: the selection is let go.
   * Without it a note would stay selected until another one was pressed.
   */
  onClearSelection?(): void;
  /**
   * Shift + press on empty board space: draw a selection rectangle instead of panning.
   *
   * The two share a surface and must not share a meaning, so the modifier is what tells them apart —
   * a story 1 drag still pans, exactly as it did, and a story 7 rectangle needs no new place on the
   * screen to live. Whoever asks for this owns the pointer for as long as the rectangle is being drawn,
   * which is why `marqueeActive` exists: the viewport must not start a pan underneath a rectangle that
   * is being drawn through it.
   */
  onMarqueeBegin?(event: ReactPointerEvent<HTMLDivElement>): void;
  /** Whether a selection rectangle is being drawn right now, in which case the board does not pan. */
  marqueeActive?: boolean;
}

/**
 * The infinite board: an input surface with a dot grid that moves with the camera,
 * and a world layer that holds board content in world coordinates.
 *
 * Panning: drag anywhere on empty board space, or scroll. Zooming: pinch or
 * Ctrl/Cmd + wheel around the pointer, or the zoom controls. Every gesture over the
 * board is cancelled so the browser page never scrolls or zooms instead.
 */
export function BoardViewport({
  children,
  onCreateAt,
  onClearSelection,
  onMarqueeBegin,
  marqueeActive = false,
}: BoardViewportProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSize = useViewportSize(viewportRef);
  const { camera, beginPan, panMove, endPan, wheel } = useCamera(viewportSize);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  // The press currently down on the board, to tell a click from a pan.
  const press = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);

  // React's onWheel is passive, so the wheel listener is registered by hand with
  // `{ passive: false }` to be able to preventDefault (PRD: board gestures must not
  // scroll or zoom the page).
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const extentX = rect.width > 0 ? rect.width : window.innerWidth;
      const extentY = rect.height > 0 ? rect.height : window.innerHeight;
      wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode, extentX),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode, extentY),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
    };

    const gesturePoint = (event: SafariGestureEvent): Point => {
      const rect = element.getBoundingClientRect();
      return {
        x: (event.clientX ?? rect.width / 2) - rect.left,
        y: (event.clientY ?? rect.height / 2) - rect.top,
      };
    };

    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      cameraStore.gesture({ kind: 'start', scale: gestureScale(event as SafariGestureEvent), point: { x: 0, y: 0 } });
    };

    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      cameraStore.gesture({ kind: 'change', scale: gestureScale(gesture), point: gesturePoint(gesture) });
    };

    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
      cameraStore.gesture({ kind: 'end', scale: Number.NaN, point: { x: 0, y: 0 } });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart as EventListener);
    element.addEventListener('gesturechange', onGestureChange as EventListener);
    element.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart as EventListener);
      element.removeEventListener('gesturechange', onGestureChange as EventListener);
      element.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [wheel]);

  /** The drag may only start on empty board space, never on a board object. */
  const isBoardSurface = (target: EventTarget | null): boolean => {
    const element = viewportRef.current;
    if (!element || !(target instanceof HTMLElement)) return false;
    return target === element || target.dataset.boardGrid !== undefined;
  };

  const toScreenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    if (!isBoardSurface(event.target)) return;
    // Shift on empty board space is a rectangle, not a drag: nothing is panned and no press is recorded,
    // so the release that ends the rectangle cannot be mistaken for a click that deselects.
    if (event.shiftKey && onMarqueeBegin) {
      onMarqueeBegin(event);
      return;
    }
    // A rectangle is being drawn through this surface: the pointer belongs to it until it is finished.
    if (marqueeActive) return;
    panningRef.current = true;
    setPanning(true);
    const point = toScreenPoint(event);
    press.current = { pointerId: event.pointerId, x: point.x, y: point.y, moved: false };
    viewportRef.current?.setPointerCapture(event.pointerId);
    beginPan(point);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!panningRef.current) return;
    const point = toScreenPoint(event);
    const pressed = press.current;
    if (pressed && pressed.pointerId === event.pointerId) {
      // Once the board has travelled as far as a note needs to start dragging,
      // this press is a pan: whatever was selected stays selected, because the
      // board moved and the user's intent did not.
      const travelled = Math.max(Math.abs(point.x - pressed.x), Math.abs(point.y - pressed.y));
      if (travelled >= DRAG_THRESHOLD_PX) pressed.moved = true;
    }
    panMove(point);
  };

  /** Ends the drag; the board simply stays where the last move left it. */
  const handlePointerEnd = (): void => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    const pressed = press.current;
    press.current = null;
    endPan();
    // A click on empty board space that panned nothing lets go of the selection.
    if (pressed && !pressed.moved) onClearSelection?.();
  };

  /**
   * Double-click on empty board space puts a sticky note down under the cursor,
   * so the toolbar button is a convenience and not the only way in. The click is
   * swallowed here: it must not also select or clear anything.
   */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!onCreateAt) return;
    if (!isBoardSurface(event.target)) return;
    event.stopPropagation();
    // A screen pixel and a world point only agree once the viewport's own
    // position and the zoom are taken out.
    const rect = viewportRef.current?.getBoundingClientRect();
    const screen = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    onCreateAt(screenToWorld(camera, screen));
  };

  const gridPeriod = GRID_SPACING_WORLD * camera.zoom;
  const backgroundPosition = `${mod(-camera.x * camera.zoom, gridPeriod)}px ${mod(
    -camera.y * camera.zoom,
    gridPeriod,
  )}px`;

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-interaction-state={panning ? 'panning' : 'idle'}
      style={{
        backgroundSize: `${gridPeriod}px ${gridPeriod}px`,
        backgroundPosition,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="world-layer"
        className="board-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        <div
          data-testid="origin-marker"
          className="origin-marker"
          aria-hidden="true"
          style={{ transform: `scale(${1 / camera.zoom})` }}
        />
        {children}
      </div>
    </div>
  );
}
