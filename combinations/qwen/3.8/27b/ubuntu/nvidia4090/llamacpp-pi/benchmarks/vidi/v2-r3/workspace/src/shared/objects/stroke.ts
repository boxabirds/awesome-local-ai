/**
 * Story 11 (stroke.model): the freehand pen stroke object — schema helpers
 * shared by the client tools and the tests.
 *
 * A stroke is stored like any other object (x/y/width/height/z/… in the
 * `objects` map) plus:
 *
 * - `points`: flat world coordinates `[x0, y0, x1, y1, …]` RELATIVE to the
 *   bbox origin (`x`, `y`) — the RDP-simplified recorded points;
 * - `baseWidth` / `baseHeight`: the bbox size at creation (the reference
 *   scale for `scaledPoints`);
 * - `color`: a pen colour key (`PEN_COLORS`);
 * - `thickness`: a pen thickness key (`PEN_THICKNESS_WORLD`).
 *
 * A stroke's bbox is the points' bbox expanded by half the thickness on each
 * side (world units; the thickness does not scale with zoom). A single
 * recorded point (a tap) is a dot: a `t × t` square centred on it.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../config';
import type { Point } from '../geometry';

/** A pen colour key. */
export type PenColor = keyof typeof PEN_COLORS;

/** A pen thickness key. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** A stroke as seen by the client (a full object snapshot). */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/**
 * Create a new stroke object in `doc` from the recorded (simplified) world
 * points. Returns the new object id, or `null` when the input is invalid
 * (no points, non-finite coordinates, unknown colour or thickness).
 */
function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (a.points.length === 0) return null;
  for (const p of a.points) if (!isFinitePoint(p)) return null;
  if (!(a.color in PEN_COLORS)) return null;
  if (!(a.thickness in PEN_THICKNESS_WORLD)) return null;
  const t = PEN_THICKNESS_WORLD[a.thickness];
  const half = t / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  let x: number;
  let y: number;
  let baseWidth: number;
  let baseHeight: number;
  if (a.points.length === 1) {
    // A dot: a t × t square centred on the point.
    x = a.points[0].x - half;
    y = a.points[0].y - half;
    baseWidth = t;
    baseHeight = t;
  } else {
    // Points' bbox expanded by half the thickness on each side (world units;
    // the thickness does not scale with zoom).
    x = minX - half;
    y = minY - half;
    baseWidth = maxX - minX + t;
    baseHeight = maxY - minY + t;
  }
  const rel = new Array<number>(a.points.length * 2);
  a.points.forEach((p, i) => {
    rel[2 * i] = p.x - x;
    rel[2 * i + 1] = p.y - y;
  });
  const obj = doc.getMap('objects') as Y.Map<any>;
  let maxZ = 0;
  obj.forEach((item) => {
    const z = (item.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const item = new Y.Map<any>();
      item.set('type', 'stroke');
      item.set('x', x);
      item.set('y', y);
      item.set('width', baseWidth);
      item.set('height', baseHeight);
      item.set('points', rel);
      item.set('baseWidth', baseWidth);
      item.set('baseHeight', baseHeight);
      item.set('color', a.color);
      item.set('thickness', a.thickness);
      item.set('z', maxZ + 1);
      item.set('createdAt', Date.now());
      item.set('createdBy', by);
      obj.set(id, item);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * The stroke's drawn points in absolute world coordinates at the object's
 * CURRENT size (bbox origin + relative points scaled by
 * `width / baseWidth` and `height / baseHeight`). This is what a resize does
 * to the drawing: every point scales with the box.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const out: Point[] = new Array(s.points.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = {
      x: s.x + (s.points[2 * i] as number) * sx,
      y: s.y + (s.points[2 * i + 1] as number) * sy,
    };
  }
  return out;
}
