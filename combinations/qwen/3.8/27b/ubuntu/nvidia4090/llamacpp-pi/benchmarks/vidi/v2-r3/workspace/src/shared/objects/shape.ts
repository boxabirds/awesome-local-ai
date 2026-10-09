/**
 * Story 10 (shape.model): the shape object schema helpers.
 *
 * A shape is a board object of type 'shape' with a kind (rect / ellipse /
 * diamond), a fill and stroke colour from the named palettes and a Y.Text
 * label (so concurrent labelling merges, story 3).
 *
 * Document schema:
 *   objects/<id>: Y.Map {
 *     type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *     kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
 *   }
 *
 * Every mutation is one LOCAL_ORIGIN transaction; invalid input is rejected
 * without a transaction (null / false).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../config';
import type { Point, Rect } from '../geometry';

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** A shape snapshot (the type-specific view of ObjectSnapshot). */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isFiniteRect(r: Rect): boolean {
  return fin(r.x) && fin(r.y) && fin(r.width) && fin(r.height);
}

/**
 * The stored rect for the create action: below-min or null rects become the
 * default square centred on `at`; `square` makes the rect a square of the
 * larger dragged dimension, anchored at the drag origin (`at`) on the axes
 * the origin touches.
 */
function resolveRect(a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean }): Rect {
  const D = SHAPE_DEFAULT_SIZE_WORLD;
  const rect = a.rect;
  if (rect === null || !isFiniteRect(rect) || rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    return { x: a.at.x - D / 2, y: a.at.y - D / 2, width: D, height: D };
  }
  if (!a.square) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const size = Math.max(rect.width, rect.height);
  // anchor on the corner/edge the drag origin sits on
  const x = a.at.x <= rect.x ? rect.x : a.at.x >= rect.x + rect.width ? a.at.x - size : rect.x;
  const y = a.at.y <= rect.y ? rect.y : a.at.y >= rect.y + rect.height ? a.at.y - size : rect.y;
  return { x, y, width: size, height: size };
}

/**
 * Create a shape. `rect` is the dragged world rect (already normalised);
 * `null` means a click. A rect below SHAPE_MIN_SIZE_WORLD in either
 * dimension is treated as a click: a SHAPE_DEFAULT_SIZE_WORLD square centred
 * on `at`. With `square` (Shift) both sides become the larger dragged
 * dimension, anchored at the drag origin (`at`). Returns the new id, or null
 * for an unknown kind or non-finite input (no transaction).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!(SHAPE_KINDS as readonly string[]).includes(a.kind)) return null;
  if (!fin(a.at.x) || !fin(a.at.y)) return null;
  if (a.rect !== null && !isFiniteRect(a.rect)) return null;
  const rect = resolveRect(a);
  const obj = doc.getMap('objects');
  let max = 0;
  obj.forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    const z = item.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  const id = crypto.randomUUID();
  const label = new Y.Text();
  doc.transact(() => {
    const item = new Y.Map();
    item.set('type', 'shape');
    item.set('x', rect.x);
    item.set('y', rect.y);
    item.set('width', rect.width);
    item.set('height', rect.height);
    item.set('kind', a.kind);
    item.set('fill', DEFAULT_SHAPE_FILL);
    item.set('stroke', DEFAULT_SHAPE_STROKE);
    item.set('label', label);
    item.set('z', max + 1);
    item.set('createdAt', Date.now());
    item.set('createdBy', by);
    obj.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set the fill and/or stroke of a shape by palette name. Only the given
 * colour keys are touched (label, size, position and selection unchanged).
 * Unknown names, stale ids: false without a transaction.
 */
function shapeItem(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const item = doc.getMap('objects').get(id);
  if (!(item instanceof Y.Map) || item.get('type') !== 'shape') return undefined;
  return item;
}

export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const fillOk = s.fill === undefined || s.fill in SHAPE_FILL_COLORS;
  const strokeOk = s.stroke === undefined || s.stroke in SHAPE_STROKE_COLORS;
  if (!fillOk || !strokeOk) return false;
  if (s.fill === undefined && s.stroke === undefined) return false;
  const item = shapeItem(doc, id);
  if (!item) return false;
  doc.transact(() => {
    if (s.fill !== undefined) item.set('fill', s.fill);
    if (s.stroke !== undefined) item.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's Y.Text label, for the text editor (SHAPE_LABEL_MAX_CHARS). */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = shapeItem(doc, id);
  if (!item) return undefined;
  const label = item.get('label');
  return label instanceof Y.Text ? label : undefined;
}
