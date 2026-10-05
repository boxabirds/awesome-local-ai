import { useEffect, useRef, useState } from 'react';
import type {
  JSX,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { isTypingTarget } from '../board/useBoardKeys';
import { cameraStore } from './cameraStore';
import type { Point } from './camera';
import { screenToWorld } from './camera';
import { useCamera, useViewportSize, wheelDeltaToPixels } from './useCamera';
import { isDrawingTool } from '../tools/useActiveTool';

/** Only the primary pointer button pans; other buttons stay available to objects. */
const PRIMARY_MOUSE_BUTTON = 0;

/**
 * The tools whose whole job is to draw something new, so that a double-click is never also a note.
 *
 * `isDrawingTool` is the tool hook's own answer to that question, shared with the viewport's pointer routing and
 * with the selection overlay's handles: a tool that takes every press on the board must not then be doubled by
 * the double-click that press was part of.
 *
 * `text` is not one of them: with the text tool armed a double-click is two placements, and the second one
 * lands on the text the first made. That is story 9's behaviour, decided where the text tool's presses are
 * decided, and this file has no business quietly changing it.
 */


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
  /**
   * The text tool is armed, so the next press on the board is a place to write rather than a way to move.
   *
   * It changes two things and both are about the pointer: the cursor says so, and a press is taken away
   * from everything below — no pan, no rectangle, and no press on whatever object happens to be underneath,
   * because a person aiming at empty board near a note means to write there and not to pick that note up.
   */
  textTool?: boolean;
  /**
   * Which tool the pointer is in, for the board's own sake: `select`, `text`, `shape`, `connector`.
   *
   * Two things turn on this. The surface says what it is in (`data-active-tool`), so a person looking at the
   * board and a test driving it can both tell which tool was holding the pointer. And a double-click that
   * happens while a drawing tool is armed is not a request for a sticky note: with a tool up, a press is the
   * tool's, and a board that also made a note out of the same gesture would be answering a question nobody
   * asked. In practice the tool's own sheet is under the pointer and the press never reaches the board at
   * all — but a rule that holds only because of what happens to be on top of it is a rule that breaks the
   * first time something else is drawn there.
   */
  activeTool?: string;
  /**
   * The sheet a drawing tool draws on, laid over the board.
   *
   * The viewport has no idea what it is holding: it is board content's neighbour, not its parent — it does
   * not pan or zoom while a tool is up, because a tool takes the pointer before the board ever sees it, and
   * the wheel still reaches the board by bubbling. Rendering it here rather than inside the world layer is
   * the whole of the difference between a preview drawn in screen units (a shape being dragged, which does not
   * grow when the board is zoomed mid-drag) and one drawn in board units.
   */
  toolOverlay?: ReactNode;
  /**
   * Put a piece of text down with its top-left corner at this world point.
   *
   * Handed the world point rather than the screen one because what is being asked for is a place on the
   * board, not a place on the screen: the two only agree while the camera is at its origin and one to one.
   */
  onCreateTextAt?(world: Point): void;
  /**
   * Files were dragged onto the board, dragged over it, dragged off it, and let go on it.
   *
   * Four handlers, because that is the whole of what the browser says about a drag, and the board answers all
   * four: the `dragover` answer is what makes a drop possible at all, and the `dragleave` is what takes the
   * outline back. They are handed to the surface rather than to the board's content because a file is dropped on
   * the *board* — on the space, at a point, next to the things that are already there — and a drop that landed
   * on a note is still a drop on the board at that point. So these listen on the surface, and the events that
   * start inside an object reach them by bubbling.
   *
   * What they do with the files is nobody's business here: this surface does not know what a picture is, and
   * decides nothing about the four events beyond passing them on.
   */
  onFilesDragEnter?(event: ReactDragEvent<HTMLDivElement>): void;
  onFilesDragOver?(event: ReactDragEvent<HTMLDivElement>): void;
  onFilesDragLeave?(event: ReactDragEvent<HTMLDivElement>): void;
  onFilesDrop?(event: ReactDragEvent<HTMLDivElement>): void;
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
  textTool = false,
  activeTool = 'select',
  toolOverlay = null,
  onCreateTextAt,
  onFilesDragEnter,
  onFilesDragOver,
  onFilesDragLeave,
  onFilesDrop,
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

  /**
   * The text tool, answered at the surface level.
   *
   * Three things are settled here, and the reasons they are settled *here* are the whole of it:
   *
   *   - **The press is swallowed, in the capture phase, on this element.** A listener that runs on the way
   *     down to the target, before React's own handlers on the root ever hear about the press, is what keeps
   *     a press aimed at the board from pressing a note that happens to be under it. Stopping it at the
   *     target, or in the bubbling phase, would let the object be selected and dragged by a press that was
   *     meant to write next to it.
   *   - **The placement waits for the release.** A press that becomes a drag is somebody changing their mind
   *     about where the text goes — or a stray swipe across the board — and a text object dropped at the end
   *     of every swipe is worse than no text object. So: travel past the board's own drag threshold and
   *     nothing is placed.
   *   - **It works on top of objects, not only on bare board.** The design says so, and it is also what the
   *     person means: aiming at a gap between two notes is aiming at a place for a heading, whether or not
   *     the cursor happens to be over the edge of one of them.
   *
   * The camera is read from the store rather than from this render's, because the press and the release are
   * two different frames and a zoom that happened between them belongs to neither.
   */
  const createTextRef = useRef(onCreateTextAt);
  createTextRef.current = onCreateTextAt;
  useEffect(() => {
    const surface = viewportRef.current;
    if (!surface || !textTool) return;

    let down: { pointerId: number; x: number; y: number; moved: boolean } | null = null;

    const relative = (event: { clientX: number; clientY: number }): Point => {
      const rect = surface.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent): void => {
      // Keys and presses inside a field are that field's: an empty text object already open for typing
      // keeps every keystroke it is given, including the press that lands inside it.
      if (isTypingTarget(event.target)) return;
      if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
      // The press is the placement's, and nobody else's. The board does not pan, no rectangle starts, and
      // whatever object is underneath is not pressed.
      event.stopPropagation();
      const point = relative(event);
      down = { pointerId: event.pointerId, x: point.x, y: point.y, moved: false };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (down === null || event.pointerId !== down.pointerId) return;
      const point = relative(event);
      if (Math.max(Math.abs(point.x - down.x), Math.abs(point.y - down.y)) >= DRAG_THRESHOLD_PX) down.moved = true;
    };

    const onPointerUp = (event: PointerEvent): void => {
      const pressed = down;
      down = null;
      if (pressed === null || event.pointerId !== pressed.pointerId) return;
      // A press that travelled is not a placement. Nothing is said about it: the cursor went back to where
      // it started and there is nothing on the board to point at.
      if (pressed.moved) return;
      const create = createTextRef.current;
      if (create === undefined) return;
      // Where the press *landed*, not where it lifted: a person aims by pressing, and the four pixels a
      // finger drifts between down and up are not a new place to write.
      create(screenToWorld(cameraStore.getState().camera, { x: pressed.x, y: pressed.y }));
    };

    const onCancel = (): void => {
      down = null;
    };

    // Capture on the surface, and the release on the window: the pointer may leave the board between the
    // two, and a placement that depends on where the finger happened to lift is a placement that fails.
    surface.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      surface.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [textTool]);

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
    // A drawing tool holds the pointer: the gesture that got here belongs to that tool, and a sticky note put
    // down in the middle of drawing a diamond would be an object nobody asked for.
    if (isDrawingTool(activeTool)) return;
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
      data-text-tool={textTool ? 'armed' : 'off'}
      data-active-tool={activeTool}
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
      onDragEnter={onFilesDragEnter}
      onDragOver={onFilesDragOver}
      onDragLeave={onFilesDragLeave}
      onDrop={onFilesDrop}
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
      {toolOverlay}
    </div>
  );
}
