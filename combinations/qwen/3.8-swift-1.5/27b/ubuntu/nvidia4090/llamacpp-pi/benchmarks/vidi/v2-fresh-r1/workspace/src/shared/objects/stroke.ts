// Stroke object model (story 11): create, read and hit-test freehand strokes.
// Shared by the client now; framework-free.
//
// Points are stored as a plain number array inside the object's Y.Map
// (replaced atomically, never edited point-by-point) because strokes are
// immutable after creation; only the generic x/y/width/height change on
// move/resize.

import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../config';
import { LOCAL_ORIGIN, getObjects, getMaxZ, type ObjectSnapshot } from '../board-model';
import { distanceToPolyline } from '../geometry/polyline';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };

/** A freehand stroke snapshot (story 11). */
export interface StrokeSnap extends Omit<ObjectSnapshot, 'color'> {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin, at creation size. */
  points: readonly number[];
  /** Bbox width/height at creation; render scale = width/baseWidth, height/baseHeight. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Create a new stroke from world-space points.
 * Returns the new id, or null on invalid input (empty points, non-finite
 * coordinates, unknown colour or thickness) — no transaction in that case.
 * One LOCAL_ORIGIN transaction per stroke.
 * The bbox is the points' bounds padded by thickness/2 (a single point
 * becomes a thickness-square dot).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) return null;
  }
  if (!(a.color in PEN_COLORS)) return null;
  if (!(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
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

  const x = minX - thickness / 2;
  const y = minY - thickness / 2;
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;

  const rel = new Array<number>(a.points.length * 2);
  for (let i = 0; i < a.points.length; i++) {
    rel[2 * i] = a.points[i].x - x;
    rel[2 * i + 1] = a.points[i].y - y;
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = getObjects(doc);
    const stroke = new Y.Map();
    stroke.set('type', 'stroke');
    stroke.set('x', x);
    stroke.set('y', y);
    stroke.set('width', width);
    stroke.set('height', height);
    stroke.set('points', rel);
    stroke.set('baseWidth', width);
    stroke.set('baseHeight', height);
    stroke.set('color', a.color);
    stroke.set('thickness', a.thickness);
    stroke.set('z', getMaxZ(doc) + 1);
    stroke.set('createdAt', Date.now());
    stroke.set('createdBy', by);
    objects.set(id, stroke);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * The stroke's points in world coordinates at the current size.
 * Points scale by width/baseWidth and height/baseHeight; thickness is not
 * scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const w = s.width ?? s.baseWidth;
  const h = s.height ?? s.baseHeight;
  const sx = s.baseWidth !== 0 ? w / s.baseWidth : 1;
  const sy = s.baseHeight !== 0 ? h / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    out.push({
      x: s.x + s.points[i] * sx,
      y: s.y + s.points[i + 1] * sy,
    });
  }
  return out;
}

/**
 * Hit test: true when `p` (world) is within max(thickness/2,
 * STROKE_HIT_TOLERANCE_PX / zoom) of the stroke's line — i.e. within 6
 * screen pixels or half the thickness, whichever is larger.
 */
export function hitStroke(s: StrokeSnap, p: Point, zoom: number): boolean {
  const tol = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  return distanceToPolyline(scaledPoints(s), p) <= tol;
}
