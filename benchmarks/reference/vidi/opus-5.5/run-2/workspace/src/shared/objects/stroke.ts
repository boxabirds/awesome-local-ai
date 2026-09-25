/**
 * Freehand pen strokes (anchor: stroke.model).
 *
 *   objects/<id>: Y.Map { type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *                         points: number[], baseWidth, baseHeight, color: PenColor,
 *                         thickness: PenThickness }
 *
 * The bounding box is the points' box padded by half the thickness on every side (a dot is
 * a thickness square). `points` are flattened [x0, y0, x1, y1, ...] relative to the box
 * origin at creation size and never change: strokes are immutable, and move / resize (story 7)
 * only change the generic x/y/width/height. Rendering and hit testing scale the points by
 * width/baseWidth and height/baseHeight; the thickness never scales.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, nextZ, registerSnapshotReader, type ObjectSnapshot } from '../board-model';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import type { Point } from '../geometry';

export const STROKE_TYPE = 'stroke';
const HALF = 2;

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

export function isStrokeSnap(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === STROKE_TYPE;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

registerSnapshotReader(STROKE_TYPE, (base, obj): StrokeSnap => {
  const raw = obj.get('points');
  const points =
    Array.isArray(raw) && raw.length >= HALF && raw.length % HALF === 0 && raw.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? Object.freeze(raw.slice() as number[])
      : Object.freeze([] as number[]);
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  return {
    ...base,
    type: STROKE_TYPE,
    points,
    baseWidth: positive(obj.get('baseWidth'), base.width),
    baseHeight: positive(obj.get('baseHeight'), base.height),
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
  };
});

/**
 * Adds one stroke above every other object in one LOCAL_ORIGIN transaction and returns its
 * id. Null, with nothing written, for no points, a non-finite coordinate or an unknown
 * colour or thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (!Array.isArray(a.points) || a.points.length === 0) return null;
  if (!a.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const pad = PEN_THICKNESS_WORLD[a.thickness] / HALF;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of a.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + HALF * pad;
  const height = maxY - minY + HALF * pad;
  const flat: number[] = [];
  for (const p of a.points) flat.push(p.x - x, p.y - y);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', STROKE_TYPE);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', flat);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', nextZ(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stroke's points in world units at its current position and size. */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += HALF) {
    out.push({ x: s.x + s.points[i]! * sx, y: s.y + s.points[i + 1]! * sy });
  }
  return out;
}
