/**
 * Story 10: the shape object type (shape.model).
 *
 * Schema (one entry per object in the `objects` map):
 *   type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *   kind: 'rect' | 'ellipse' | 'diamond',
 *   fill: FillColor, stroke: StrokeColor, label: Y.Text
 *
 * Creation rules (shape.create_drag / create_click / constrain):
 * - a drag rect is used as-is;
 * - a click (rect null) or a drag below SHAPE_MIN_SIZE_WORLD in either
 *   dimension creates a SHAPE_DEFAULT_SIZE_WORLD square centred on the
 *   drag-start/click point;
 * - `square` (Shift) sets both sides to the larger dragged dimension,
 *   anchored at the drag origin.
 *
 * Selection, move, resize and delete come from the generic story 7
 * machinery (shapes register in the object registry).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../config';

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects');
}

function shapeOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'shape') return undefined;
  return obj;
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** True for a known shape kind. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/**
 * Creates a shape (shape.create_drag / create_click / shape.constrain).
 * Returns the new id, or null (no transaction) for an unknown kind, a
 * non-finite point, or a non-finite rect.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
  if (a.rect !== null && !isFiniteRect(a.rect)) return null;

  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Click (or a tiny drag): standard size centred on the point.
    x = a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2;
    y = a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2;
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
  } else if (a.square) {
    // Shift: square anchored at the drag origin, larger dimension wins.
    const side = Math.max(a.rect.width, a.rect.height);
    x = a.at.x;
    y = a.at.y;
    width = side;
    height = side;
  } else {
    x = a.rect.x;
    y = a.rect.y;
    width = a.rect.width;
    height = a.rect.height;
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map();
    obj.set('type', 'shape');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Changes a shape's fill and/or outline colour (shape.style). Touches only
 * the colour keys. Returns true when a change was applied; false (no
 * transaction) for a stale id or an unknown colour name.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const fill = s.fill !== undefined ? s.fill : null;
  const stroke = s.stroke !== undefined ? s.stroke : null;
  if (fill !== null && !(fill in SHAPE_FILL_COLORS)) return false;
  if (stroke !== null && !(stroke in SHAPE_STROKE_COLORS)) return false;
  const obj = shapeOf(doc, id);
  if (!obj) return false;
  if ((fill === null || obj.get('fill') === fill) && (stroke === null || obj.get('stroke') === stroke)) {
    return false;
  }
  doc.transact(() => {
    if (fill !== null) obj.set('fill', fill);
    if (stroke !== null) obj.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's label Y.Text (edited with story 2's editor, SHAPE_LABEL_MAX_CHARS). */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = shapeOf(doc, id);
  if (!obj) return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** The shape's colours, or undefined for a stale id / malformed object. */
export function getShapeStyle(
  doc: Y.Doc,
  id: string,
): { fill: FillColor; stroke: StrokeColor } | undefined {
  const obj = shapeOf(doc, id);
  if (!obj) return undefined;
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  if (typeof fill !== 'string' || !(fill in SHAPE_FILL_COLORS)) return undefined;
  if (typeof stroke !== 'string' || !(stroke in SHAPE_STROKE_COLORS)) return undefined;
  return { fill: fill as FillColor, stroke: stroke as StrokeColor };
}

/** The shape's kind, or undefined for a stale id / malformed object. */
export function getShapeKind(doc: Y.Doc, id: string): ShapeKind | undefined {
  const kind = shapeOf(doc, id)?.get('kind');
  return isShapeKind(kind) ? kind : undefined;
}
