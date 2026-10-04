import { DRAG_THRESHOLD_PX } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

/**
 * The board's own surface, which is the frame every pointer point is measured against.
 *
 * The camera says where the world is *relative to the board area*, and a pointer event says where
 * the pointer is relative to the window. The two are the same numbers only because the board fills
 * the window; on a page that scrolled or padded, the difference is exactly the board area's box.
 * Asking the document for it, rather than being handed it, is what lets a tool be mounted without a
 * prop list that carries the viewport's geometry through three components that do not want it.
 */
export const BOARD_SURFACE_SELECTOR = '[data-testid="board-viewport"]';

/** Screen point relative to the top-left of the board area; the client point when there is no board. */
export function boardPoint(client: Point): Point {
  const surface =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>(BOARD_SURFACE_SELECTOR);
  const box = surface?.getBoundingClientRect();
  // A surface that has not been laid out reports a box of nothing, which is jsdom's whole idea of a
  // layout: in that case the client point *is* the board point, which is what a component test that
  // sets no camera and no scroll expects.
  if (box === undefined || (box.width === 0 && box.height === 0 && box.left === 0 && box.top === 0)) {
    return { x: client.x, y: client.y };
  }
  return { x: client.x - box.left, y: client.y - box.top };
}

/** Where a pointer event is, in board units, at the camera's current zoom and position. */
export function worldPoint(camera: Camera, event: { clientX: number; clientY: number }): Point {
  return screenToWorld(camera, boardPoint({ x: event.clientX, y: event.clientY }));
}

/** A press on a toolbar, a swatch or a handle is not a press on the board. */
export function isBoardUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-board-ui]') !== null;
}

/** Only the left button (or a pen or a finger, which report no button at all). */
export function isPrimaryButton(event: PointerEvent | MouseEvent): boolean {
  return event.button === 0;
}

/**
 * The box between two points, whichever way the drag went.
 *
 * A drag backwards - right to left, bottom to top - is the same box as the drag the other way, and
 * the only honest way to say so is to sort the two edges. Without this a leftward drag reports a
 * negative width, which the model refuses, and a shape that could only be drawn to the right of
 * where the pointer started is a shape that cannot be drawn.
 */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** How far the pointer travelled between going down and letting go, in screen pixels. */
export function travelled(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** A press that stayed where it went down, so far as the board is concerned. */
export function isClick(from: Point, to: Point): boolean {
  return travelled(from, to) < DRAG_THRESHOLD_PX;
}

/**
 * Shift's square, in screen units, for the preview to show.
 *
 * The model does the same thing to the box it is given (`squareRect` in the shape model), and the
 * preview has to say what the shape will be: a dashed box that is a rectangle and a shape that comes
 * out a square would teach the person that the modifier means something other than what it means.
 */
export function squareBox(box: Rect, origin: Point): Rect {
  const side = Math.max(box.width, box.height);
  return {
    x: origin.x < box.x ? box.x + box.width - side : box.x,
    y: origin.y < box.y ? box.y + box.height - side : box.y,
    width: side,
    height: side,
  };
}

/** Attach the move and release of one drag to the window, so a pointer that leaves the board is
 * still the same drag, and give back the one call that stops listening. */
export function onDragEnds(
  onMove: (event: PointerEvent) => void,
  onUp: (event: PointerEvent) => void,
): () => void {
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
}
