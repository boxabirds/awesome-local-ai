/**
 * Shapes (story 10): rectangles, ellipses and diamonds with a fill, an outline and a centred
 * label.
 *
 *   objects/<id>: Y.Map {
 *     type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *     kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
 *   }
 *
 * Selection, moving, resizing and deleting use the generic operations in board-model.ts. Like
 * board-model.ts: every successful change is one `LOCAL_ORIGIN` transaction; rejected calls
 * return null / false before any transaction is opened.
 */
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  type FillColor,
  type StrokeColor,
} from '../config';
import {
  isFillColor,
  isShapeKind,
  isStrokeColor,
  LOCAL_ORIGIN,
  maxZ,
  objectOf,
  SHAPE_TYPE,
  type ObjectSnapshot,
  type ShapeKind,
} from '../board-model';
import type { Point, Rect } from '../geometry';

export { SHAPE_TYPE, isShapeKind, type ShapeKind };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  width: number;
  height: number;
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export function isShape(obj: ObjectSnapshot): obj is ShapeSnap {
  return obj.type === SHAPE_TYPE && obj.kind !== undefined;
}

const HALF = 2;

function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * The rect a creation gesture produces. A missing rect (click) or one smaller than
 * SHAPE_MIN_SIZE_WORLD in either dimension (tiny drag) gives a SHAPE_DEFAULT_SIZE_WORLD square
 * centred at `at` (shape.create_click). With `square`, both sides take the larger dimension,
 * keeping the corner nearest `at` (the drag origin) fixed (shape.constrain).
 */
export function shapeRect(rect: Rect | null, at: Point, square = false): Rect {
  if (!rect || rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    const half = SHAPE_DEFAULT_SIZE_WORLD / HALF;
    return { x: at.x - half, y: at.y - half, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
  }
  if (!square) return { ...rect };
  const side = Math.max(rect.width, rect.height);
  // The origin is the rect corner nearest `at`; the square grows away from it.
  const originRight = Math.abs(at.x - (rect.x + rect.width)) < Math.abs(at.x - rect.x);
  const originBottom = Math.abs(at.y - (rect.y + rect.height)) < Math.abs(at.y - rect.y);
  return {
    x: originRight ? rect.x + rect.width - side : rect.x,
    y: originBottom ? rect.y + rect.height - side : rect.y,
    width: side,
    height: side,
  };
}

/**
 * Creates a shape of `kind` (see shapeRect for sizing) with the default fill and outline and an
 * empty label, above every other object. Null (no transaction) for an unknown kind or a
 * non-finite rect or point.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind) || !finite(a.at.x, a.at.y)) return null;
  if (a.rect && !finite(a.rect.x, a.rect.y, a.rect.width, a.rect.height)) return null;
  const r = shapeRect(a.rect, a.at, a.square ?? false);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    const z = maxZ(doc) + 1;
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
    obj.set('type', SHAPE_TYPE);
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectOf(doc, id);
  return obj && obj.get('type') === SHAPE_TYPE ? obj : undefined;
}

/**
 * Sets the fill and/or outline colour by name. Only the colour keys are touched (label, size,
 * position unchanged). False (no transaction) for stale ids, unknown colour names, an empty
 * request and no-ops.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill === undefined && s.stroke === undefined) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const obj = shapeMap(doc, id);
  if (!obj) return false;
  const fillChanges = s.fill !== undefined && obj.get('fill') !== s.fill;
  const strokeChanges = s.stroke !== undefined && obj.get('stroke') !== s.stroke;
  if (!fillChanges && !strokeChanges) return false;
  doc.transact(() => {
    if (fillChanges) obj.set('fill', s.fill);
    if (strokeChanges) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's label text (edited with the shared text editor), or undefined for stale ids. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeMap(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
