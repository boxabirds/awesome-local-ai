/**
 * The shape object (schema: `shape.model`): a rectangle, ellipse or diamond with a fill, an
 * outline and a centred label.
 *
 * A shape borrows everything it can from the shared model, the way free text does: the
 * common fields, the one entry in the `objects` map, the same `createdBy` rule, and the same
 * `Y.Text` that lets two people type in one object at the same time (story 3). What is new
 * is three fields of its own:
 *
 *  - `kind`: one of `SHAPE_KINDS`, and the only thing that decides which outline is drawn
 *    inside the stored rect — a shape *is* its bounding rect, which is why resize, selection
 *    and the arrow anchors all work off the same four numbers;
 *  - `fill` and `stroke`: the *names* of entries in the two palettes in `config.ts`, never
 *    hex values. The palette belongs to the product, so a shape keeps its meaning when the
 *    palette is retuned, and a board cannot be talked into a colour it never offered.
 *    `'none'` is a fill you can see through, not a missing colour.
 *
 * Two rules hold for every change here, and both are load-bearing for the sync layer:
 *
 *  - a bad input (an unknown kind, an unknown colour, a `NaN` in the rect) returns before a
 *    transaction opens, so a rejection costs no update and no sync traffic;
 *  - a change that would write what is already there writes nothing at all.
 *
 * Shared and framework-free, so the Worker that syncs boards can import it. Importing it
 * declares the type to the shared model, which is what lets `boardObjects` read a shape's
 * own fields.
 */

import * as Y from 'yjs';
import { createId, declareObjectType, LOCAL_ORIGIN, maxZ, objectMap, type ObjectSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor
} from '../config';
import type { Point, Rect } from '../geometry';

/** The object type name this module owns. */
export const SHAPE_OBJECT_TYPE = 'shape';

/**
 * The kind and the two palette names, under the names the code that draws a shape uses for
 * them. They are declared with the settings in `../config.ts`, which is where their hexes
 * live; a caller that wants a shape's vocabulary should not have to know which of the two
 * files a name was put in.
 */
export type { FillColor, ShapeKind, StrokeColor } from '../config';

/** A shape, as the screen and the snapshot worker read it. */
export interface ShapeSnap extends ObjectSnapshot {
  readonly type: 'shape';
  /** A shape carries its box from the moment it is created: it is the outline's rect. */
  readonly width: number;
  readonly height: number;
  /** Rectangle, ellipse or diamond. */
  kind: ShapeKind;
  /** The palette name of the fill, or `'none'`. */
  fill: FillColor;
  /** The palette name of the outline. */
  stroke: StrokeColor;
  /** The label's characters, for drawing it, fitting it and naming the shape aloud. */
  label: string;
  /** When this shape was made, in epoch milliseconds. 0 for a shape that never said. */
  readonly createdAt: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Is `kind` one of the three shapes this build can draw? */
export function isShapeKind(kind: unknown): kind is ShapeKind {
  return typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind);
}

/** Is `color` one of the palette's fill names, `'none'` included? (A raw hex is not.) */
export function isFillColor(color: unknown): color is FillColor {
  return typeof color === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, color);
}

/** Is `color` one of the palette's outline names? */
export function isStrokeColor(color: unknown): color is StrokeColor {
  return typeof color === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, color);
}

/**
 * The shape's own reader: see `declareObjectType` in `../board-model.ts`.
 *
 * A label that is not a `Y.Text` cannot be typed into, and a kind, fill or stroke this build
 * has never heard of would draw nothing or the wrong thing, so each falls back to the
 * default rather than dropping a shape somebody drew.
 */
function readShapeObject(object: Y.Map<unknown>, common: ObjectSnapshot): ShapeSnap {
  const label = object.get('label');
  const createdAt = object.get('createdAt');
  return {
    ...common,
    type: SHAPE_OBJECT_TYPE,
    width: isFiniteNumber(object.get('width')) ? (object.get('width') as number) : SHAPE_DEFAULT_SIZE_WORLD,
    height: isFiniteNumber(object.get('height')) ? (object.get('height') as number) : SHAPE_DEFAULT_SIZE_WORLD,
    kind: isShapeKind(object.get('kind')) ? (object.get('kind') as ShapeKind) : SHAPE_KINDS[0],
    fill: isFillColor(object.get('fill')) ? (object.get('fill') as FillColor) : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(object.get('stroke')) ? (object.get('stroke') as StrokeColor) : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
    createdAt: isFiniteNumber(createdAt) ? (createdAt as number) : 0
  };
}

declareObjectType(SHAPE_OBJECT_TYPE, readShapeObject);

/** The objects map, typed the way the model uses it. */
function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** A shape's `Y.Map`, or undefined when the id is not a shape on this board. */
function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objectMap(doc, id);
  return object && object.get('type') === SHAPE_OBJECT_TYPE ? object : undefined;
}

/** A standard shape with `at` at its centre: what a click drops. */
function standardRect(at: Point): Rect {
  const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
  return { x: at.x - half, y: at.y - half, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
}

/**
 * The rect to store, or `null` for "create nothing".
 *
 * A drag smaller than `SHAPE_MIN_SIZE_WORLD` in either direction is a click that wobbled, and
 * gets the standard size centred where the pointer went down; a square constraint takes the
 * larger dimension, so a hand-drawn square stays as big as the hand reached.
 */
function resolveRect(rect: Rect | null, at: Point, square: boolean): Rect | null {
  if (!rect) return standardRect(at);
  if (!isFiniteNumber(rect.x) || !isFiniteNumber(rect.y) || !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) {
    return null;
  }
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) return standardRect(at);
  if (!square) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const side = Math.max(rect.width, rect.height);
  // Anchored at the drag origin, so the shape keeps the corner the drag started from.
  return { x: rect.x, y: rect.y, width: side, height: side };
}

/** A shape drag: where the pointer went down, where it came to rest, and whether Shift was held. */
export interface ShapeDrag {
  readonly from: Point;
  readonly to: Point;
  readonly square: boolean;
}

/** The box between two corners, however the pointer travelled. */
function dragRect(from: Point, to: Point): Rect | null {
  if (!from || !to) return null;
  if (!isFiniteNumber(from.x) || !isFiniteNumber(from.y)) return null;
  if (!isFiniteNumber(to.x) || !isFiniteNumber(to.y)) return null;
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  };
}

/**
 * What a drag asks the model for: the rect it drew, or `null` with the point a standard shape
 * is centred on (`shape.create_click`).
 *
 * This is the tool's whole decision, and it is made here rather than in the component so that
 * the preview, the creation and the tests cannot each have their own idea of when a drag
 * stopped being a click.
 */
export function shapeRequestFromDrag(drag: ShapeDrag): { rect: Rect | null; at: Point } {
  const at = drag && drag.from && isFiniteNumber(drag.from.x) && isFiniteNumber(drag.from.y)
    ? { x: drag.from.x, y: drag.from.y }
    : { x: 0, y: 0 };
  const rect = drag ? dragRect(drag.from, drag.to) : null;
  if (!rect) return { rect: null, at };
  const tooSmall = rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;
  return { rect: tooSmall ? null : rect, at };
}

/**
 * The box the shape made from `drag` will occupy — which is what the tool draws while the
 * pointer is still down, so that the dashed outline and the shape that arrives are the same
 * rectangle by construction rather than by two implementations agreeing by luck.
 */
export function shapeRectFromDrag(drag: ShapeDrag): Rect {
  const request = shapeRequestFromDrag(drag);
  return resolveRect(request.rect, request.at, drag?.square === true) ?? standardRect(request.at);
}

/**
 * Draw a shape (`shape.draw`) and return its id.
 *
 * `rect` is the drag, already normalised so the width and height are positive; pass `null`
 * for a click, which drops a standard shape centred on `at`. A drag too small to be a shape
 * becomes the same standard shape, because a person who meant to draw one should not have to
 * draw it again. `square` is the Shift key. The new shape is on top, carries the identity of
 * whoever drew it when there is one, and its label starts empty — it is a shape first, and
 * words are added when the person wants them.
 *
 * Returns `null` when the request is not something the model can hold: an unknown kind, or a
 * position or size that is not a real number. A rejection opens no transaction, so nobody
 * else on the board sees anything at all.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind | string; rect: Rect | null; at: Point; square?: boolean },
  by: string
): string | null {
  if (!a || !isShapeKind(a.kind)) return null;
  if (!a.at || !isFiniteNumber(a.at.x) || !isFiniteNumber(a.at.y)) return null;
  const rect = resolveRect(a.rect, a.at, a.square === true);
  if (!rect) return null;

  let created: string | null = null;
  doc.transact(() => {
    const id = createId();
    const object = new Y.Map<unknown>();
    object.set('id', id);
    object.set('type', SHAPE_OBJECT_TYPE);
    object.set('x', rect.x);
    object.set('y', rect.y);
    object.set('width', rect.width);
    object.set('height', rect.height);
    // Created on top: a shape you drew and cannot find is the worst kind of success.
    object.set('z', maxZ(doc) + 1);
    object.set('kind', a.kind);
    object.set('fill', DEFAULT_SHAPE_FILL);
    object.set('stroke', DEFAULT_SHAPE_STROKE);
    object.set('createdAt', Date.now());
    // A `Y.Text` rather than a string, so two people typing into the label converge (story 3).
    object.set('label', new Y.Text());
    if (typeof by === 'string' && by !== '') object.set('createdBy', by);
    objectsOf(doc).set(id, object);
    created = id;
  }, LOCAL_ORIGIN);
  return created;
}

/**
 * Change a shape's fill and/or outline (`shape.style`).
 *
 * A colour outside the palette — including a raw hex value — is a product violation, so the
 * whole call is refused rather than applied half-way, and nothing is written. So is a change
 * that would leave the shape looking exactly as it did, which is what makes it safe to wire a
 * swatch straight to this function.
 *
 * Only the named fields are written, so a colour change leaves the label, the box, the layer
 * and the other colour alone. Returns whether it wrote.
 */
export function setShapeStyle(doc: Y.Doc, id: string, style: { fill?: string; stroke?: string }): boolean {
  const object = shapeMap(doc, id);
  if (!object) return false;
  if (style.fill !== undefined && !isFillColor(style.fill)) return false;
  if (style.stroke !== undefined && !isStrokeColor(style.stroke)) return false;

  const changes: Array<[string, string]> = [];
  if (style.fill !== undefined && object.get('fill') !== style.fill) changes.push(['fill', style.fill]);
  if (style.stroke !== undefined && object.get('stroke') !== style.stroke) changes.push(['stroke', style.stroke]);
  if (changes.length === 0) return false;

  doc.transact(() => {
    for (const [key, value] of changes) object.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shape's label as shared text, for typing into and for observing — or nothing when that
 * object is not a shape. The label is the thing the person wrote, so it is a `Y.Text`.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = shapeMap(doc, id);
  if (!object) return undefined;
  const label = object.get('label');
  return label instanceof Y.Text ? label : undefined;
}
