/**
 * Shape object model (story 10, shape.model).
 *
 * A shape is a Y.Map under the board's `objects` map with:
 *   type: 'shape'
 *   x, y, width, height: world-space rect
 *   kind: ShapeKind ('rect' | 'ellipse' | 'diamond')
 *   fill: FillColor
 *   stroke: StrokeColor
 *   label: Y.Text
 *   z, createdAt, createdBy: standard fields
 *
 * All mutations are no-ops (return null/false, emit no transaction) when
 * inputs are invalid.
 */

import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../config';
import type { ShapeKind, FillColor, StrokeColor } from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import { getSessionId } from './text';
import type { Rect } from '../geometry';
import type { Point } from '../../client/canvas/camera';

// --- Y.Map keys ----------------------------------------------------------------

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const KIND_KEY = 'kind';
const FILL_KEY = 'fill';
const STROKE_KEY = 'stroke';
const LABEL_KEY = 'label';
const Z_KEY = 'z';
const CREATED_AT_KEY = 'createdAt';
const CREATED_BY_KEY = 'createdBy';
const OBJECTS_KEY = 'objects';
const SHAPE_TYPE = 'shape';

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function getShapeMap(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get(TYPE_KEY) !== SHAPE_TYPE) return undefined;
  return obj;
}

// --- Validation ------------------------------------------------------------------

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && value in SHAPE_FILL_COLORS;
}

function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && value in SHAPE_STROKE_COLORS;
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height)
  );
}

// --- Mutations -------------------------------------------------------------------

/**
 * Create a shape.
 *
 * - `rect` null or smaller than SHAPE_MIN_SIZE_WORLD in either dimension:
 *   creates SHAPE_DEFAULT_SIZE_WORLD × SHAPE_DEFAULT_SIZE_WORLD centred at `at`.
 * - `square: true`: both sides = max(width, height), anchored at rect top-left.
 * - Unknown kind or non-finite rect/point: returns null, no transaction.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
  if (a.rect !== null && !isFiniteRect(a.rect)) return null;

  let r: Rect;
  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    r = { x: a.at.x - s / 2, y: a.at.y - s / 2, width: s, height: s };
  } else {
    r = { ...a.rect };
    if (a.square) {
      const s = Math.max(r.width, r.height);
      r = { x: r.x, y: r.y, width: s, height: s };
    }
  }

  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, SHAPE_TYPE);
  obj.set(X_KEY, r.x);
  obj.set(Y_KEY, r.y);
  obj.set(WIDTH_KEY, r.width);
  obj.set(HEIGHT_KEY, r.height);
  obj.set(KIND_KEY, a.kind);
  obj.set(FILL_KEY, DEFAULT_SHAPE_FILL);
  obj.set(STROKE_KEY, DEFAULT_SHAPE_STROKE);
  obj.set(LABEL_KEY, new Y.Text());
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  obj.set(CREATED_BY_KEY, getSessionId());

  doc.transact(() => {
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change a shape's fill and/or stroke colour.
 * Returns false for a stale id or unknown colour name (no transaction).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const obj = getShapeMap(doc, id);
  if (!obj) return false;

  let changed = false;
  if (s.fill !== undefined) {
    if (!isFillColor(s.fill)) return false;
    if (obj.get(FILL_KEY) === s.fill) return false;
    changed = true;
  }
  if (s.stroke !== undefined) {
    if (!isStrokeColor(s.stroke)) return false;
    if (obj.get(STROKE_KEY) === s.stroke) return false;
    changed = true;
  }
  if (!changed) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set(FILL_KEY, s.fill);
    if (s.stroke !== undefined) obj.set(STROKE_KEY, s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shape's Y.Text for label editing. Undefined for a stale id or
 * non-shape object.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getShapeMap(doc, id);
  if (!obj) return undefined;
  const label = obj.get(LABEL_KEY);
  return label instanceof Y.Text ? label : undefined;
}
