// Shapes (story 10, shape.model): rectangles, ellipses and diamonds with a
// fill, an outline and a centred label. Framework-free like board-model.
//
// objects/<id>: Y.Map {
//   type: 'shape', x, y, width, height, z, createdAt, createdBy,
//   kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
// }
import * as Y from 'yjs';
import {
  getObject,
  getObjectsMap,
  isFiniteNumber,
  LOCAL_ORIGIN,
  maxZ,
  registerModelType,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../config';
import type { Point, Rect } from '../geometry';

export const SHAPE_TYPE = 'shape';

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type { FillColor, StrokeColor };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  createdBy: string;
}

const HALF = 2;

export function isShapeKind(k: unknown): k is ShapeKind {
  return typeof k === 'string' && (SHAPE_KINDS as readonly string[]).includes(k);
}

export function isFillColor(c: unknown): c is FillColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, c);
}

export function isStrokeColor(c: unknown): c is StrokeColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, c);
}

export function isShape(obj: ObjectSnapshot): obj is ShapeSnap {
  return obj.type === SHAPE_TYPE;
}

function getShapeObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj?.get('type') === SHAPE_TYPE ? obj : undefined;
}

function readShape(base: ObjectSnapshot, obj: Y.Map<unknown>): ShapeSnap {
  const kind = obj.get('kind');
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const label = obj.get('label');
  const createdBy = obj.get('createdBy');
  return {
    ...base,
    type: 'shape',
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

registerModelType(SHAPE_TYPE, readShape);

/**
 * The rect a creation gesture produces (shape.create_drag, create_click,
 * constrain). `rect` null, or smaller than SHAPE_MIN_SIZE_WORLD on either
 * axis, is a click: a SHAPE_DEFAULT_SIZE_WORLD square centred on `at`. With
 * `square` both sides take the larger dragged dimension, anchored at the drag
 * origin `at` (the square grows in the direction that was dragged).
 */
export function shapeRect(rect: Rect | null, at: Point, square = false): Rect {
  const r = rect && (rect.width < 0 || rect.height < 0)
    ? {
        x: Math.min(rect.x, rect.x + rect.width),
        y: Math.min(rect.y, rect.y + rect.height),
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
      }
    : rect;
  if (!r || r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    return {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (!square) return { ...r };
  const side = Math.max(r.width, r.height);
  // The origin is the corner the drag started from; the square extends away from it.
  const leftward = at.x > r.x + r.width / HALF;
  const upward = at.y > r.y + r.height / HALF;
  return {
    x: leftward ? r.x + r.width - side : r.x,
    y: upward ? r.y + r.height - side : r.y,
    width: side,
    height: side,
  };
}

function finiteRect(r: Rect): boolean {
  return isFiniteNumber(r.x) && isFiniteNumber(r.y) && isFiniteNumber(r.width) && isFiniteNumber(r.height);
}

/**
 * Creates a shape with a white fill, dark outline and empty label on top of
 * every object. Returns the id, or null (nothing written) for an unknown kind
 * or a non-finite rect/point.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!isFiniteNumber(a.at?.x) || !isFiniteNumber(a.at?.y)) return null;
  if (a.rect !== null && (!a.rect || !finiteRect(a.rect))) return null;
  const r = shapeRect(a.rect, a.at, a.square ?? false);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', SHAPE_TYPE);
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
    getObjectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Changes only the fill and/or outline colour (shape.style). False, with
 * nothing written, for a stale id, an unknown colour name, or no change.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill === undefined && s.stroke === undefined) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const obj = getShapeObject(doc, id);
  if (!obj) return false;
  const fill = s.fill !== undefined && obj.get('fill') !== s.fill;
  const stroke = s.stroke !== undefined && obj.get('stroke') !== s.stroke;
  if (!fill && !stroke) return false;
  doc.transact(() => {
    if (fill) obj.set('fill', s.fill);
    if (stroke) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The label's Y.Text for the text editor (limited to SHAPE_LABEL_MAX_CHARS there). */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = getShapeObject(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
