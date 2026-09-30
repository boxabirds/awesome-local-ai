/**
 * Shape object model (story 10, shape.model).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *     kind: ShapeKind,
 *     fill: FillColor,
 *     stroke: StrokeColor,
 *     label: Y.Text
 *   }
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type ShapeKind,
  type FillColor,
  type StrokeColor,
} from '../config';
import type { Rect, Point } from '../geometry';

export type { ShapeKind, FillColor, StrokeColor };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function isShape(obj: ObjectMap | undefined): obj is ObjectMap {
  return !!obj && obj.get('type') === 'shape';
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Creates a shape of the given kind.
 *
 * - `rect` non-null and ≥ SHAPE_MIN_SIZE_WORLD in both dimensions: use as-is.
 * - `rect` null or below SHAPE_MIN_SIZE_WORLD in either dimension: create a
 *   SHAPE_DEFAULT_SIZE_WORLD square centred on `at`.
 * - `square: true`: both dimensions = max(w, h), anchored at the drag origin.
 *
 * Returns the new id, or null for unknown kind / non-finite rect.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string
): string | null {
  // Validate kind
  if (!SHAPE_KINDS.includes(a.kind)) return null;

  // Validate point
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;

  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: default size centred at `at`
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    // Validate rect
    if (
      !Number.isFinite(a.rect.x) || !Number.isFinite(a.rect.y) ||
      !Number.isFinite(a.rect.width) || !Number.isFinite(a.rect.height)
    ) {
      return null;
    }

    // If below minimum in either dimension, treat as click
    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else {
      width = a.rect.width;
      height = a.rect.height;
      x = a.rect.x;
      y = a.rect.y;

      // Square constraint: both sides = larger dimension, anchored at drag origin
      if (a.square) {
        const size = Math.max(width, height);
        width = size;
        height = size;
      }
    }
  }

  const id = crypto.randomUUID();
  const label = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'shape');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', label);
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Sets the fill and/or stroke of a shape. Validates against the palettes.
 * Returns true on success, false for unknown colours / stale ids.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;
  const obj = objects(doc).get(id);
  if (!isShape(obj)) return false;
  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Returns the Y.Text label of a shape, or undefined for stale/non-shape ids.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!isShape(obj)) return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}
