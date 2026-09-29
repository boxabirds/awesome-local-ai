/**
 * Stroke (freehand drawing) object model (story 11, stroke.model).
 *
 * A stroke is a Y.Map under the board's `objects` map with:
 *   type: 'stroke'
 *   x, y, width, height: world-space bbox (point bounds padded by half thickness)
 *   points: number[]    flattened [x0, y0, x1, y1, ...] RELATIVE to the bbox
 *                       origin at base size
 *   baseWidth, baseHeight: creation-time size (proportional-resize anchor)
 *   color: PenColor
 *   thickness: PenThickness ('thin' | 'medium' | 'thick')
 *   z, createdAt, createdBy: standard fields
 *
 * The stored rect may change with moves and aspect-locked resizes (story 7);
 * `scaledPoints` maps the stored points into the current rect so resizing
 * scales the geometry proportionally while the thickness stays constant
 * (pen.resize).
 *
 * All mutations are no-ops (return null, emit no transaction) when inputs
 * are invalid.
 */

import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../config';
import type { PenColor, PenThickness } from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point } from '../../client/canvas/camera';

// --- Y.Map keys -----------------------------------------------------------------

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const POINTS_KEY = 'points';
const BASE_WIDTH_KEY = 'baseWidth';
const BASE_HEIGHT_KEY = 'baseHeight';
const COLOR_KEY = 'color';
const THICKNESS_KEY = 'thickness';
const Z_KEY = 'z';
const CREATED_AT_KEY = 'createdAt';
const CREATED_BY_KEY = 'createdBy';
const OBJECTS_KEY = 'objects';

/** The stroke object type in the board doc. */
export const STROKE_TYPE = 'stroke';

/** A stroke as emitted by `snapshot()`: the generic object fields plus the
 *  flattened point list (relative to the bbox origin, at base size) and the
 *  creation-time size used for proportional rendering. */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

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

function isFinitePoint(p: { x: number; y: number } | null | undefined): p is Point {
  return p !== null && p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// --- Mutations -------------------------------------------------------------------

/**
 * Add a stroke to the doc, on top of all existing objects.
 *
 * Returns the new object id, or null (no transaction opened) when:
 * - the point list is empty,
 * - any point has a non-finite coordinate, or
 * - the colour / thickness name is unknown.
 *
 * The point list is stored as given (the Pen tool simplifies before calling;
 * this layer does not re-simplify). The stored bbox is the point bounds
 * padded by half the thickness so the round caps fit; for a single point it
 * is exactly the thickness square centred on the point (pen.dot).
 *
 * All writes happen in one LOCAL_ORIGIN transaction so the whole stroke
 * arrives as a single update (and one undo step — the caller stops the undo
 * capture after each commit, undo.stopCapturing).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const { points } = a;
  if (points.length === 0) return null;
  for (const p of points) if (!isFinitePoint(p)) return null;
  if (typeof a.color !== 'string' || !(a.color in PEN_COLORS)) return null;
  if (typeof a.thickness !== 'string' || !(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const half = thickness / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - half;
  const y = minY - half;
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;

  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, STROKE_TYPE);
  obj.set(X_KEY, x);
  obj.set(Y_KEY, y);
  obj.set(WIDTH_KEY, width);
  obj.set(HEIGHT_KEY, height);
  const flat: number[] = new Array(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    flat[i * 2] = points[i]!.x - x;
    flat[i * 2 + 1] = points[i]!.y - y;
  }
  obj.set(POINTS_KEY, flat);
  obj.set(BASE_WIDTH_KEY, width);
  obj.set(BASE_HEIGHT_KEY, height);
  obj.set(COLOR_KEY, a.color);
  obj.set(THICKNESS_KEY, a.thickness);
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  obj.set(CREATED_BY_KEY, by);
  doc.transact(
    () => {
      objects(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

// --- Reads ------------------------------------------------------------------------

/**
 * Map a stroke's stored (relative, base-size) points into world coordinates
 * for the current rect: each relative coordinate is scaled by
 * `current / base` in its axis. A stroke that was never resized scales by 1,
 * i.e. the points come out exactly as drawn.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const baseW = s.baseWidth > 0 ? s.baseWidth : 1;
  const baseH = s.baseHeight > 0 ? s.baseHeight : 1;
  const sx = (s.width ?? baseW) / baseW;
  const sy = (s.height ?? baseH) / baseH;
  const n = Math.floor(s.points.length / 2);
  const out: Point[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = {
      x: s.x + (s.points[i * 2] ?? 0) * sx,
      y: s.y + (s.points[i * 2 + 1] ?? 0) * sy,
    };
  }
  return out;
}

/**
 * World-space hit tolerance for selecting a stroke at a given zoom (world
 * units): the pen line's half thickness, widened to at least
 * STROKE_HIT_TOLERANCE_PX of SCREEN pixels so a stroke is pickable by its
 * line at any zoom (pen.select).
 */
export function strokeHitTolerance(s: Pick<StrokeSnap, 'thickness'>, zoom: number): number {
  const thickness = PEN_THICKNESS_WORLD[s.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / z);
}
