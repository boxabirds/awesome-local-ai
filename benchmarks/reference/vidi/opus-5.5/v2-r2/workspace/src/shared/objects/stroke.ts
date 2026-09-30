// Pen strokes (story 11): immutable freehand lines. Only the generic
// x/y/width/height change after creation (move and resize).
//
// objects/<id>: Y.Map {
//   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
//   points: number[]   // flattened [x0, y0, x1, y1, ...] relative to the bbox origin, at creation size
//   baseWidth, baseHeight, color: PenColor, thickness: PenThickness
// }
// The bbox is the points' bounds padded by thickness / 2 (a dot: a thickness square).
import * as Y from 'yjs';
import { type ObjectSnapshot, LOCAL_ORIGIN, maxZ, objectsMap } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../config';
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

export function isStroke(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === 'stroke';
}

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

/** Whether `value` is a usable flattened point list (non-empty, even length, all finite). */
export function isStrokePoints(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length % 2 === 0 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

/**
 * Creates a stroke above every other object from world-space points in one
 * LOCAL_ORIGIN transaction. Null, and nothing written, for no points, any
 * non-finite coordinate, or an unknown colour or thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (!Array.isArray(a.points) || a.points.length === 0) return null;
  if (!a.points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const half = PEN_THICKNESS_WORLD[a.thickness] / 2;
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
  const x = minX - half;
  const y = minY - half;
  const width = maxX - minX + 2 * half;
  const height = maxY - minY + 2 * half;
  const flat: number[] = [];
  for (const p of a.points) flat.push(p.x - x, p.y - y);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('points', flat);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's points in world units at its current size: stored points scaled
 * by width / baseWidth and height / baseHeight. Thickness is never scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) out.push({ x: s.x + s.points[i]! * sx, y: s.y + s.points[i + 1]! * sy });
  return out;
}
