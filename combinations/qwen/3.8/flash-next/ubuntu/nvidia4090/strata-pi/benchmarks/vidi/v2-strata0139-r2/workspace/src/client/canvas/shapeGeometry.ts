import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_STROKE_WIDTH_WORLD } from "../../shared/config";
import type { Point, Rect } from "../../shared/geometry";
import { normalizeRect } from "../../shared/geometry";
import type { Camera } from "./camera";
import { screenToWorld } from "./camera";

/**
 * The Shape tool's arithmetic (`shape.create_drag`, `shape.create_click`,
 * `shape.constrain`).
 *
 * A press is a **screen** gesture and a shape is a **board** rectangle, so the
 * two ends of the drag are converted with the camera here. The dashed preview the
 * tool draws while dragging is the same rectangle in screen space: what a person
 * sees is what the model is given.
 *
 * The board-side rules (a drag under `SHAPE_MIN_SIZE_WORLD` becomes the standard
 * size, Shift makes both sides equal) live in the model's `createShape`. Keeping
 * the Shift rule here too — for the preview only — means the preview and the
 * shape that appears are the same rectangle.
 */

/** A dragged rectangle in board units, from the two ends of a screen drag. */
export function dragRectWorld(camera: Camera, start: Point, end: Point): Rect {
  const from = screenToWorld(camera, start);
  const to = screenToWorld(camera, end);
  return normalizeRect(from, to);
}

/** The rectangle a plain click makes: the standard size, centred on the click. */
export function clickRectWorld(camera: Camera, at: Point, size = SHAPE_DEFAULT_SIZE_WORLD): Rect {
  const world = screenToWorld(camera, at);
  return { x: world.x - size / 2, y: world.y - size / 2, width: size, height: size };
}

/**
 * The Shift-constrained square of a drag, in the same screen space as the drag:
 * the larger dragged side, anchored on the corner the drag started from.
 */
export function squareFromDrag(start: Point, end: Point): Rect {
  const side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return {
    x: end.x >= start.x ? start.x : start.x - side,
    y: end.y >= start.y ? start.y : start.y - side,
    width: side,
    height: side,
  };
}

/** The rectangle the tool's dashed preview draws, in screen pixels. */
export function previewScreenRect(start: Point, end: Point, square: boolean): Rect {
  return square ? squareFromDrag(start, end) : normalizeRect(start, end);
}

/**
 * The rectangle a label is laid out in: the shape's box inset by half its
 * outline, so text is measured against the space inside the stroke rather than
 * against the space the stroke is drawn in.
 */
export function shapeContentRect(box: Rect): Rect {
  const inset = SHAPE_STROKE_WIDTH_WORLD / 2;
  return { x: box.x + inset, y: box.y + inset, width: Math.max(0, box.width - inset * 2), height: Math.max(0, box.height - inset * 2) };
}
