import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };

const OBJECT_TYPE_STROKE = 'stroke';

/**
 * Render-ready snapshot of a stroke object (story 11).
 *
 * `points` is the flattened `[x0, y0, x1, y1, ...]` polyline **relative to
 * the bbox origin at the creation size** (`baseWidth`/`baseHeight`). Generic
 * move/resize only change `x`/`y`/`width`/`height`; `scaledPoints` derives
 * the world-space polyline at the current size. Thickness is never scaled.
 */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function isPenColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, c);
}

function isPenThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t);
}

/**
 * Create a stroke object from world-space points.
 *
 * The bbox is the points' bbox padded by half the thickness, so the line and
 * its ends are fully inside the object; a single point produces a
 * thickness×thickness square (rendered as a round dot).
 *
 * Returns the new id, or `null` for invalid input (no transaction).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!Array.isArray(a.points) || a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }
  if (!isPenColor(a.color)) return null;
  if (!isPenThickness(a.thickness)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - t / 2;
  const y = minY - t / 2;
  const width = maxX - minX + t;
  const height = maxY - minY + t;

  const rel: number[] = [];
  for (const p of a.points) rel.push(p.x - x, p.y - y);

  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', OBJECT_TYPE_STROKE);
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('points', rel);
    m.set('baseWidth', width);
    m.set('baseHeight', height);
    m.set('color', a.color);
    m.set('thickness', a.thickness);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * World-space points of a stroke at its current size: the stored (relative)
 * points scaled by `width/baseWidth` and `height/baseHeight`, re-based on
 * `(x, y)`. Thickness is never scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}

/**
 * Points relative to the stroke's bbox origin (no x/y re-basing), for
 * rendering inside an SVG whose local coordinate system starts at the
 * object's top-left corner.
 */
export function localScaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    out.push({ x: s.points[i] * sx, y: s.points[i + 1] * sy });
  }
  return out;
}

/** Read a stroke snapshot from the doc (used by `objects()` in board-model). */
export function readStrokeSnap(id: string, m: Y.Map<unknown>): StrokeSnap | null {
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  const width = m.get('width');
  const height = m.get('height');
  const baseWidth = m.get('baseWidth');
  const baseHeight = m.get('baseHeight');
  const points = m.get('points');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (!isFiniteNumber(baseWidth) || !isFiniteNumber(baseHeight) || baseWidth <= 0 || baseHeight <= 0) {
    return null;
  }
  if (!Array.isArray(points) || points.length === 0 || !points.every(isFiniteNumber)) return null;
  const color = m.get('color');
  const thickness = m.get('thickness');
  return {
    id,
    type: 'stroke',
    x,
    y,
    z,
    width,
    height,
    points: points as number[],
    baseWidth,
    baseHeight,
    color: isPenColor(color) ? color : 'black',
    thickness: isPenThickness(thickness) ? thickness : 'medium',
  };
}
