// The shape object model (story 10, design section 3): rect / ellipse / diamond
// with a centred label. It lives in the SAME `objects` map as the sticky note and
// free text, so story 7's select / move / resize / z-order and story 8's undo act
// on it without knowing it exists; the only new fields are the shape's kind, its
// fill, its outline and its label.
//
// Every write is a LOCAL_ORIGIN transaction - exactly what story 8's undo
// captures, one style change one undo step - and every refusal happens BEFORE a
// transaction is opened, so a refused write emits zero update events.
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../config.ts';
import type { FillColor, ShapeKind, StrokeColor } from '../config.ts';
import type { Point, Rect } from '../geometry.ts';
import { LOCAL_ORIGIN, objectsMapOf } from '../board-model.ts';
import type { ObjectSnapshot } from '../board-model.ts';

/** The one type string this object is stored under. */
export const SHAPE_TYPE = 'shape';

// The two style fields a shape carries, both product colour NAMES.
export interface ShapeStyle {
  fill: FillColor;
  stroke: StrokeColor;
}

// A shape's own fields on top of the generic object snapshot.
export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  createdBy: string;
}

function shapeMapOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMapOf(doc).get(id);
  if (!m || m.get('type') !== SHAPE_TYPE) return undefined;
  return m;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMapOf(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Is `v` one of the three shape kinds? */
export function isShapeKind(v: unknown): v is ShapeKind {
  return (SHAPE_KINDS as readonly unknown[]).includes(v);
}

/** Is `v` one of the seven fill names (including 'none' for no fill)? */
export function isFillColor(v: unknown): v is FillColor {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, v);
}

/** Is `v` one of the six outline names? */
export function isStrokeColor(v: unknown): v is StrokeColor {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, v);
}

/** The shape a click lands: `SHAPE_DEFAULT_SIZE_WORLD` square, CENTRED on `at`. */
export function defaultShapeRect(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

/**
 * Create a shape inside one LOCAL_ORIGIN transaction and return its id.
 *
 * `rect` is the area dragged out; `at` is the point pressed (or released). A
 * `rect` of null - or one smaller than `SHAPE_MIN_SIZE_WORLD` on a side - counts
 * as a click and lands the default size centred on `at`. `square` (Shift held)
 * squares the dragged area on its longer side first. The shape is created on top
 * of every other object (`maxZ + 1`).
 *
 * Bad input - unknown kind, non-finite rect, non-finite `at` - returns null and
 * opens NO transaction at all.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  createdBy: string,
): string | null {
  if (!a || !isShapeKind(a.kind)) return null;
  if (!a.at || !isCoord(a.at.x) || !isCoord(a.at.y)) return null;

  let rect: Rect | null = null;
  if (a.rect !== null && a.rect !== undefined) {
    const r = a.rect;
    if (!isCoord(r.x) || !isCoord(r.y) || !isCoord(r.width) || !isCoord(r.height)) return null;
    let width = Math.max(0, r.width);
    let height = Math.max(0, r.height);
    if (a.square) {
      // Shift: the dragged area becomes a square on its longer side, anchored
      // at the same corner, so the drag direction is preserved.
      const side = Math.min(Math.max(width, height), MAX_OBJECT_SIZE_WORLD);
      width = side;
      height = side;
    }
    rect = {
      x: r.x,
      y: r.y,
      width: Math.min(width, MAX_OBJECT_SIZE_WORLD),
      height: Math.min(height, MAX_OBJECT_SIZE_WORLD),
    };
    // A drag too small to be a shape is a click.
    if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
      rect = defaultShapeRect(a.at);
    }
  } else {
    rect = defaultShapeRect(a.at);
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', SHAPE_TYPE);
    m.set('x', rect!.x);
    m.set('y', rect!.y);
    m.set('width', rect!.width);
    m.set('height', rect!.height);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', now);
    m.set('createdBy', createdBy);
    m.set('kind', a.kind);
    m.set('fill', DEFAULT_SHAPE_FILL);
    m.set('stroke', DEFAULT_SHAPE_STROKE);
    m.set('label', new Y.Text(''));
    objectsMapOf(doc).set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change a shape's fill and/or outline inside one LOCAL_ORIGIN transaction.
 *
 * `fill` must be one of the seven fill names ('none' included) and `stroke` one
 * of the six outline names. Anything else - an off-palette colour, an id that is
 * not there, an id that is not a shape, a change that would alter nothing - is
 * refused with false and opens NO transaction.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: Partial<ShapeStyle>, by?: string): boolean {
  const m = shapeMapOf(doc, id);
  if (!m) return false;

  const keys: Array<'fill' | 'stroke'> = [];
  if (s.fill !== undefined) {
    if (!isFillColor(s.fill)) return false;
    if (m.get('fill') !== s.fill) keys.push('fill');
  }
  if (s.stroke !== undefined) {
    if (!isStrokeColor(s.stroke)) return false;
    if (m.get('stroke') !== s.stroke) keys.push('stroke');
  }
  if (keys.length === 0) return false;

  doc.transact(() => {
    for (const key of keys) m.set(key, s[key] as FillColor | StrokeColor);
  }, LOCAL_ORIGIN);
  void by;
  return true;
}

/** The shape's label text, for binding an editor to it. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = shapeMapOf(doc, id);
  if (!m) return undefined;
  const label = m.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** Is this snapshot a shape? Narrows the generic snapshot to `ShapeSnapshot`. */
export function isShapeSnapshot(obj: ObjectSnapshot): obj is ShapeSnapshot {
  return obj.type === SHAPE_TYPE;
}
