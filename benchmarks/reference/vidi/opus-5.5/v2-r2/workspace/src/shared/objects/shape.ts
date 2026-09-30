// Shapes (story 10): rectangles, ellipses and diamonds with a fill, an outline and a centred label.
//
// objects/<id>: Y.Map {
//   type: 'shape', x, y, width, height, z, createdAt, createdBy,
//   kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
// }
import * as Y from 'yjs';
import { type ObjectSnapshot, LOCAL_ORIGIN, getObject, maxZ, objectsMap } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../config';
import { type Point, type Rect, isFiniteRect } from '../geometry';

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type { FillColor, StrokeColor } from '../config';

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export function isShape(obj: ObjectSnapshot): obj is ShapeSnap {
  return obj.type === 'shape';
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * The world rect a new shape gets: `square` makes both sides the larger one
 * (anchored at the rect's top-left); a missing rect or one below
 * SHAPE_MIN_SIZE_WORLD on either side becomes a SHAPE_DEFAULT_SIZE_WORLD square
 * centred on `at` (a click).
 */
export function newShapeRect(rect: Rect | null, at: Point, square = false): Rect {
  if (rect) {
    let { width, height } = rect;
    if (square) width = height = Math.max(width, height);
    if (width >= SHAPE_MIN_SIZE_WORLD && height >= SHAPE_MIN_SIZE_WORLD) {
      return {
        x: rect.x,
        y: rect.y,
        width: Math.min(width, MAX_OBJECT_SIZE_WORLD),
        height: Math.min(height, MAX_OBJECT_SIZE_WORLD),
      };
    }
  }
  const size = SHAPE_DEFAULT_SIZE_WORLD;
  return { x: at.x - size / 2, y: at.y - size / 2, width: size, height: size };
}

/**
 * Creates a shape above every other object (see `newShapeRect` for its rect).
 * Null, and nothing written, for an unknown kind or non-finite coordinates.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind) || !isFinitePoint(a.at) || (a.rect && !isFiniteRect(a.rect))) return null;
  const r = newShapeRect(a.rect, a.at, a.square);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function getShapeObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj && obj.get('type') === 'shape' ? obj : undefined;
}

/**
 * Changes a shape's fill and/or outline (palette names). False, and nothing
 * written, for stale ids, unknown colours, an empty request or no change.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill === undefined && s.stroke === undefined) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const obj = getShapeObject(doc, id);
  if (!obj) return false;
  const fill = s.fill !== undefined && obj.get('fill') !== s.fill ? s.fill : undefined;
  const stroke = s.stroke !== undefined && obj.get('stroke') !== s.stroke ? s.stroke : undefined;
  if (fill === undefined && stroke === undefined) return false;
  doc.transact(() => {
    if (fill !== undefined) obj.set('fill', fill);
    if (stroke !== undefined) obj.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = getShapeObject(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
