// Shape objects: rectangles, ellipses and diamonds with a centred label.
//
// A shape is an ordinary entry in the board's one `objects` map: the id is
// generated here, the whole entry is written in ONE transaction with
// `LOCAL_ORIGIN`, and so one shape is one undo step, one broadcast and one Y.Map
// — never two objects half-written.
//
// Colours are stored as palette KEYS and the kind as one of `SHAPE_KINDS`, in
// the document rather than in this module, because a shape that named a colour
// the palette no longer offers would have nothing to be drawn with. Reading
// either falls back to the default, so a document written by something else is
// drawn rather than throwing. The outline width is not stored at all: it is
// `SHAPE_STROKE_WIDTH_WORLD`, read where the shape is drawn, because nothing in
// the product lets anybody give one shape a thicker line than another.
//
// The label is a `Y.Text` — the same kind of shared text a sticky note's and a
// free text object's words are — so everything story 3 built for two people
// typing into one object applies to it unchanged.

import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
} from '../config';
import { getObjects, isFiniteNumber, LOCAL_ORIGIN, maxZ, newId, resizeObjects } from '../board-model';
import { clampToLimit } from '../text-edit';
import type { Point, Rect } from '../geometry';

export type { ShapeFillColor, ShapeKind, ShapeStrokeColor } from '../config';
export { isShapeKind } from '../config';

/**
 * A shape as it is read back out of the document. `label` is clamped, so nothing
 * downstream renders past the limit.
 */
export interface ShapeSnapshot {
  id: string;
  type: 'shape';
  /** Top-left corner, board units. */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  kind: ShapeKind;
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  /** The shape's label, clamped to `SHAPE_LABEL_MAX_CHARS`. */
  label: string;
  createdBy?: string;
}

/**
 * How a shape is being made: by a drag (`rect`, already normalised so `x`/`y` is
 * the top-left corner, `square` when Shift is held) or by a click (`rect` null,
 * `at` the point clicked). `at` is always where the pointer went down, so a
 * click and a stunted drag leave the same shape in the same place.
 */
export interface ShapeCreation {
  kind: ShapeKind;
  rect: Rect | null;
  at: Point;
  square?: boolean;
}

export function isShapeFillColor(value: unknown): value is ShapeFillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

export function isShapeStrokeColor(value: unknown): value is ShapeStrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

/** A rect is usable when all four numbers are finite and both sides are positive. */
function isRect(value: Rect | null | undefined): value is Rect {
  return (
    value !== null &&
    value !== undefined &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

/** The standard shape, centred on `at` (shape.create_click). */
export function defaultShapeRect(at: Point): Rect {
  const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
  return { x: at.x - half, y: at.y - half, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
}

/**
 * The box the shape gets: the drag as drawn, or — when the drag is narrower than
 * `SHAPE_MIN_SIZE_WORLD` in either direction, or there was no drag at all — the
 * standard size centred on the point it was clicked at. With Shift both sides
 * become the larger of the two dragged dimensions, anchored at the drag's origin
 * (shape.create_shift).
 */
export function shapeBox(creation: ShapeCreation): Rect {
  const { rect, square } = creation;
  if (rect === null || rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    return defaultShapeRect(creation.at);
  }
  if (square) {
    const side = Math.max(rect.width, rect.height);
    return { x: rect.x, y: rect.y, width: side, height: side };
  }
  return { ...rect };
}

/**
 * Add a shape and return its id, or return null and write nothing when the kind
 * is one the board does not draw, or a number in the box is not a number.
 *
 * One transaction: kind, box, colours, `z` above every object already there,
 * `createdAt`, and `createdBy` when there is a person to name.
 */
export function createShape(doc: Y.Doc, creation: ShapeCreation, by?: string): string | null {
  if (!(SHAPE_KINDS as readonly string[]).includes(creation.kind)) return null;
  if (!isFiniteNumber(creation.at.x) || !isFiniteNumber(creation.at.y)) return null;
  if (creation.rect !== null && !isRect(creation.rect)) return null;

  const objects = getObjects(doc);
  const id = newId();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    const box = shapeBox(creation);
    map.set('type', 'shape');
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('kind', creation.kind);
    map.set('fill', DEFAULT_SHAPE_FILL);
    map.set('stroke', DEFAULT_SHAPE_STROKE);
    map.set('label', new Y.Text());
    map.set('z', maxZ(objects) + 1);
    if (by !== undefined && by !== '') map.set('createdBy', by);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Give a shape a fill from the palette, an outline colour, or both.
 *
 * Every name is checked before anything is written, so an unknown colour — a
 * misspelling, or one from a palette this board does not have — is refused with
 * no transaction opened and no update emitted, and a shape is never left half
 * restyled (shape.restyle_rejects_unknown). A colour the shape already has is
 * accepted and writes nothing.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (!(map instanceof Y.Map)) return false;
  if (map.get('type') !== 'shape') return false;

  const writes: [string, string][] = [];
  if (style.fill !== undefined) {
    if (!isShapeFillColor(style.fill)) return false;
    if (map.get('fill') !== style.fill) writes.push(['fill', style.fill]);
  }
  if (style.stroke !== undefined) {
    if (!isShapeStrokeColor(style.stroke)) return false;
    if (map.get('stroke') !== style.stroke) writes.push(['stroke', style.stroke]);
  }
  if (writes.length === 0) return true;

  doc.transact(() => {
    for (const [key, value] of writes) map.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's label text, for the label editor. Undefined when there is no such shape. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = getObjects(doc).get(id);
  if (!(map instanceof Y.Map) || map.get('type') !== 'shape') return undefined;
  const label = map.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** A stored label clamped to the limit the editor stops at. */
export function shapeLabel(map: Y.Map<unknown>): string {
  const label = map.get('label');
  if (!(label instanceof Y.Text)) return '';
  return clampToLimit(label.toString(), SHAPE_LABEL_MAX_CHARS);
}

/** Remove a shape, or say there is no shape with that id. */
export function deleteShape(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (!(map instanceof Y.Map) || map.get('type') !== 'shape') return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Resize a shape, with the shared bounds checks and clamps. */
export function resizeShape(doc: Y.Doc, id: string, rect: Rect): boolean {
  return resizeObjects(doc, new Map([[id, rect]])) === 1;
}
