/**
 * Shape object model (story 10, shape.model).
 *
 * A `shape` object is a labelled, coloured geometric figure:
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *   kind: ShapeKind,   // 'rect' | 'ellipse' | 'diamond'
 *   fill: ShapeFillColor,
 *   stroke: ShapeStrokeColor,
 *   label: Y.Text
 * }
 * ```
 *
 * Selection, move, resize, delete and undo are the generic story 7/8
 * operations; nothing shape-specific is added there.
 */

import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeKind,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Immutable snapshot of a shape object. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  label: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Create a shape (shape.create_drag / shape.create_click / shape.constrain).
 *
 * - `rect` null, or smaller than SHAPE_MIN_SIZE_WORLD in either dimension,
 *   creates a standard SHAPE_DEFAULT_SIZE_WORLD square centred on `at`;
 * - `square: true` (Shift) makes both sides the larger dragged dimension,
 *   anchored at the drag origin (the rect's top-left);
 * - unknown kind or non-finite rect/point → null, no transaction.
 *
 * One LOCAL_ORIGIN transaction per success. Returns the new id.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind and finiteness first (null, no transaction).
  if (!SHAPE_KINDS.includes(a.kind)) return null;
  if (!isFiniteNumber(a.at.x) || !isFiniteNumber(a.at.y)) return null;
  if (a.rect !== null) {
    const r = a.rect;
    if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) {
      return null;
    }
  }

  // Click / tiny drag → standard size centred on the click point.
  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    x = a.rect.x;
    y = a.rect.y;
    width = a.rect.width;
    height = a.rect.height;
  }

  // Shift: both sides the larger dimension, anchored at the drag origin.
  if (a.square) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const label = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'shape');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  obj.set('kind', a.kind);
  obj.set('fill', DEFAULT_SHAPE_FILL);
  obj.set('stroke', DEFAULT_SHAPE_STROKE);
  obj.set('label', label);

  doc.transact(() => {
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Apply a fill and/or outline colour to a shape (shape.style).
 * Colours are validated against the palettes; only the given keys are
 * touched. Stale id or unknown colour → false, no transaction.
 * One LOCAL_ORIGIN transaction per success.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  // Validate names against the palettes; stale id or unknown colour → false.
  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;
  const obj = getObjects(doc).get(id);
  if (!obj) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill as ShapeFillColor);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke as ShapeStrokeColor);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * The Y.Text label of a shape (for story 2's text editor), or undefined
 * for a stale id.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObjects(doc).get(id);
  if (!obj) return undefined;
  return obj.get('label') as Y.Text | undefined;
}
