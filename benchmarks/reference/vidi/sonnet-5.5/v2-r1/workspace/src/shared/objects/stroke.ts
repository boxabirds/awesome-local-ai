import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, objectsOf } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import type { PenColor, PenThickness } from '../config';
import type { Point } from '../geometry';

export type { PenColor, PenThickness } from '../config';

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

const HALF = 2;

export function isPenColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, c);
}
export function isPenThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t);
}

/**
 * Adds a stroke through the world `points`. Null (and no transaction) for no points, a non-finite coordinate,
 * or an unknown colour or thickness. A single point is a dot: the box is a square of the thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (a.points.length === 0 || !a.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const t = PEN_THICKNESS_WORLD[a.thickness];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX + t;
  const height = maxY - minY + t;
  const flat: number[] = [];
  for (const p of a.points) flat.push(p.x - minX + t / HALF, p.y - minY + t / HALF);

  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'stroke');
    obj.set('x', minX - t / HALF);
    obj.set('y', minY - t / HALF);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', flat);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stroke's points in world space at its current size (thickness is never scaled). */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += HALF) out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  return out;
}
