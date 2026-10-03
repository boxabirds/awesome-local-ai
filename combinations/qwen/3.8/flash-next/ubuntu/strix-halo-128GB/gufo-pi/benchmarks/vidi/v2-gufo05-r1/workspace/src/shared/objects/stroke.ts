/**
 * A freehand stroke: the ink left by one Pen gesture (story 11, `stroke.model`).
 *
 * A stroke is an `ObjectSnapshot` — it has a position, a size and a z, so it moves through
 * the shared objects map, moves with the board, and resizes with the existing handles with no
 * special-casing. What it adds is the `points` of the drawn line, stored in a way that lets the
 * box resize without rewriting them:
 *
 * - `points` are flattened `[x0,y0, x1,y1, …]`, **relative to the bounding-box origin**, and
 *   recorded at the size the stroke was drawn at (`baseWidth`/`baseHeight`).
 * - `scaledPoints` multiplies them by `width / baseWidth` and `height / baseHeight`, so resizing
 *   the box stretches the line to fit. Points are never rewritten on resize; the line is
 *   recomputed from the box, exactly as a connector recomputes its path from its endpoints.
 *
 * A single point (a click) is a legal stroke: it stores two coordinates and draws as a dot with
 * a round cap.
 */
import * as Y from 'yjs';

import {
  highestZ,
  LOCAL_ORIGIN,
  OBJECTS_KEY,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { distanceToPolyline } from '../geometry/polyline';

export const STROKE_TYPE = 'stroke';

/** An object as saved, narrowed to a stroke. */
export interface StrokeSnap extends ObjectSnapshot {
  type: typeof STROKE_TYPE;
  /** Flattened `[x0,y0,…]`, relative to the bbox origin, at the creation size. */
  points: readonly number[];
  /** The width/height the points were recorded against; the box scales from these. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  /** Who drew it; kept so the record matches every other object type. */
  readonly createdBy: string;
}

export interface CreateStrokeArgs {
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

/** Is `value` one of the six pen colours? */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && value in PEN_COLORS;
}

/** Is `value` one of the three pen thicknesses? */
export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD;
}

/** Every coordinate finite, and at least one point? A stroke with nothing in it is not a stroke. */
function validPoints(points: readonly Point[]): boolean {
  if (points.length === 0) return false;
  return points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * Write a stroke built from `points` (world units) into the shared objects map, and return its id
 * — or `null` for an empty path or a non-finite coordinate, without opening a transaction, so a
 * rejected stroke is never synced or undone (`stroke.model`).
 *
 * The bounding box is the path's extent padded by half the thickness on every side, so a round
 * cap never runs past the box. The points are stored relative to that padded origin at the box's
 * creation size; a later resize stretches them back rather than rewriting them.
 */
export function createStroke(
  doc: Y.Doc,
  args: CreateStrokeArgs,
  by: string,
): string | null {
  const { points, color, thickness } = args;
  if (!validPoints(points)) return null;
  if (!isPenColor(color) || !isPenThickness(thickness)) return null;

  const half = PEN_THICKNESS_WORLD[thickness] / 2;
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
  // Pad by half the thickness so the round cap at each extreme stays inside the box.
  const x = minX - half;
  const y = minY - half;
  const width = maxX - minX + half * 2;
  const height = maxY - minY + half * 2;

  // Points relative to the padded origin, flattened. A single point lands at the box centre.
  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', STROKE_TYPE);
    map.set('x', x);
    map.set('y', y);
    map.set('width', width);
    map.set('height', height);
    map.set('points', flat);
    map.set('baseWidth', width);
    map.set('baseHeight', height);
    map.set('color', color);
    map.set('thickness', thickness);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', by);
    (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's points in the box's local frame (origin at the box's top-left), stretched to the
 * box's *current* width and height.
 *
 * At creation the scale is 1, so these are the stored points; resize the box and they scale with
 * it — double the box, double the coordinates (`stroke.model`). A degenerate base (zero) falls
 * back to scale 1 rather than dividing by nothing.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    const px = s.points[i];
    const py = s.points[i + 1];
    if (px === undefined || py === undefined) continue;
    out.push({ x: px * sx, y: py * sy });
  }
  return out;
}

/**
 * The stroke's points in world coordinates — the local scaled points shifted by the box origin.
 * Used for hit-testing and by tests that measure in the same frame as a click.
 */
export function worldPoints(s: StrokeSnap): Point[] {
  return scaledPoints(s).map((p) => ({ x: s.x + p.x, y: s.y + p.y }));
}

/**
 * Would a click at world `point` select this stroke (`pen.select`)?
 *
 * Distance from the (resized) line, within `max(half the thickness, STROKE_HIT_TOLERANCE_PX /
 * zoom)`: a thin stroke at any zoom is still clickable (the screen-px term), and a thick one is
 * clickable across its whole ink. This is the predicate the object's hit layer is sized to match,
 * so what a test computes and what a browser hit-tests agree.
 */
export function strokeHitTest(s: StrokeSnap, point: Point, zoom: number): boolean {
  const line = worldPoints(s);
  if (line.length === 0) return false;
  const tolerance = Math.max(
    PEN_THICKNESS_WORLD[s.thickness] / 2,
    zoom > 0 ? STROKE_HIT_TOLERANCE_PX / zoom : STROKE_HIT_TOLERANCE_PX,
  );
  return distanceToPolyline(line, point) <= tolerance;
}

/**
 * Read a saved stroke out of the objects map. Fields fall back to safe defaults where a
 * malformed value would only affect appearance, and the box is clamped to the minimum size so
 * a stroke is never drawn as nothing. The points are the flattened relative coordinates.
 */
export function snapshotFrom(id: string, map: Y.Map<unknown>): StrokeSnap {
  const raw = map.get('points');
  const points = Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];
  const color = map.get('color');
  const thickness = map.get('thickness');
  const createdAt = map.get('createdAt');
  return {
    id,
    type: STROKE_TYPE,
    x: Number(map.get('x')),
    y: Number(map.get('y')),
    width: Math.max(STROKE_MIN_SIZE_WORLD, storedPositive(map.get('width'), STROKE_MIN_SIZE_WORLD)),
    height: Math.max(STROKE_MIN_SIZE_WORLD, storedPositive(map.get('height'), STROKE_MIN_SIZE_WORLD)),
    points,
    baseWidth: storedPositive(map.get('baseWidth'), STROKE_MIN_SIZE_WORLD),
    baseHeight: storedPositive(map.get('baseHeight'), STROKE_MIN_SIZE_WORLD),
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
    z: Number(map.get('z')),
    createdBy: String(map.get('createdBy') ?? ''),
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/** A stored positive size, or `fallback` when it is missing, non-numeric, or not positive. */
function storedPositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
