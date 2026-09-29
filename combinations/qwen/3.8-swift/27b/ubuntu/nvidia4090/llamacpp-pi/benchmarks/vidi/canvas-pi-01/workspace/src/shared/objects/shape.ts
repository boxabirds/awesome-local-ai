// Shape object model (see spec: shape.model).
//
// A shape is a board object of type 'shape':
//   objects/<id>: Y.Map {
//     type: 'shape', x, y, width, height, z, createdAt, createdBy,
//     kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
//   }
//
// Selection, move, resize, delete and undo are the generic story 7/8 object
// operations — nothing shape-specific is added there (shapes behave like
// every other object).

import * as Y from 'yjs';
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
import {
  LOCAL_ORIGIN,
  registerObjectTypeName,
  type ObjectSnapshot,
} from '../board-model';

/** The three drawable shape kinds. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** Fill colour keys of the shape toolbar (including 'none'). */
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
/** Outline colour keys of the shape toolbar. */
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** A shape object (ObjectSnapshot with the shape fields present). */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

// The model owns its type name so documents with shapes can be snapshotted
// even before the client registry loads (unit tests, worker).
registerObjectTypeName('shape');

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function finiteRect(r: Rect): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite);
}

/**
 * Create a shape. `rect` (world units) is the dragged area; null means a
 * click, and a rect smaller than SHAPE_MIN_SIZE_WORLD in either dimension is
 * also treated as a click: both become a SHAPE_DEFAULT_SIZE_WORLD square
 * centred on `at`. `square` (Shift) makes width = height = the larger
 * dragged dimension, anchored at the drag origin (top-left of `rect`).
 * Returns the new id; null (no transaction) for an unknown kind or
 * non-finite rect/point. One LOCAL_ORIGIN transaction on success.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind) || !finitePoint(a.at)) return null;
  if (a.rect !== null && !finiteRect(a.rect)) return null;

  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Click (or tiny drag): standard size centred on the click point.
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else if (a.square === true) {
    // Shift: square/circular — the larger dragged dimension, anchored at the
    // drag origin (top-left of the dragged rect).
    const side = Math.max(a.rect.width, a.rect.height);
    width = side;
    height = side;
    x = a.rect.x;
    y = a.rect.y;
  } else {
    x = a.rect.x;
    y = a.rect.y;
    width = a.rect.width;
    height = a.rect.height;
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const object = new Y.Map();
    object.set('type', 'shape');
    object.set('x', x);
    object.set('y', y);
    object.set('width', width);
    object.set('height', height);
    object.set('kind', a.kind);
    object.set('fill', DEFAULT_SHAPE_FILL);
    object.set('stroke', DEFAULT_SHAPE_STROKE);
    object.set('label', new Y.Text());
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a shape's fill and/or outline colour by palette key. Both keys are
 * validated against SHAPE_FILL_COLORS / SHAPE_STROKE_COLORS; unknown keys or
 * a stale id → false (no transaction). Only colour keys are touched. One
 * LOCAL_ORIGIN transaction on success.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const { fill, stroke } = s;
  if (
    (fill !== undefined && (typeof fill !== 'string' || !(fill in SHAPE_FILL_COLORS))) ||
    (stroke !== undefined && (typeof stroke !== 'string' || !(stroke in SHAPE_STROKE_COLORS)))
  ) {
    return false;
  }
  if (fill === undefined && stroke === undefined) return false;
  const object = objects(doc).get(id);
  if (object === undefined || object.get('type') !== 'shape') return false;
  doc.transact(() => {
    if (fill !== undefined) object.set('fill', fill);
    if (stroke !== undefined) object.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's editable label Y.Text, if the shape exists. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objects(doc).get(id);
  if (object === undefined) return undefined;
  const label = object.get('label');
  return label instanceof Y.Text ? label : undefined;
}
