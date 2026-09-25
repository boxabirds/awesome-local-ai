// Freehand pen strokes (story 11).
//
// objects/<id>: Y.Map { type: 'stroke', x, y, width, height, z, createdAt, createdBy,
//                       points: number[], baseWidth, baseHeight, color: PenColor, thickness: PenThickness }
//
// `points` is flattened [x0, y0, x1, y1, ...] relative to the box's top-left at creation size; the box is the
// points' bounds padded by half the thickness, and baseWidth/baseHeight is that box's size. Strokes are immutable
// after creation: the points are written once and never edited; moving and resizing are the generic story 7
// writes of x/y/width/height, and the drawn line is scaled by width/baseWidth and height/baseHeight when read.
import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, registerSnapshotReader, type ObjectSnapshot } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../config';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

export function isPenColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.hasOwn(PEN_COLORS, c);
}

export function isPenThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.hasOwn(PEN_THICKNESS_WORLD, t);
}

export function isStroke(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === 'stroke';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPointList(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 2 && v.length % 2 === 0 && v.every(isFiniteNumber);
}

registerSnapshotReader('stroke', (_id, obj, base) => {
  const points = obj.get('points');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  if (!isPointList(points) || !isFiniteNumber(baseWidth) || !isFiniteNumber(baseHeight)) return null;
  if (baseWidth <= 0 || baseHeight <= 0 || !isPenColor(color) || !isPenThickness(thickness)) return null;
  return { ...base, type: 'stroke', points: Object.freeze(points.slice()), baseWidth, baseHeight, color, thickness } satisfies StrokeSnap;
});

/**
 * Adds a finished stroke above all other objects in one LOCAL_ORIGIN transaction and returns its id. One point
 * makes a dot whose box is a thickness-sided square. Null (and no transaction) for no points, a non-finite
 * coordinate, or an unknown colour or thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (!Array.isArray(a.points) || a.points.length === 0) return null;
  if (!a.points.every((p) => isFiniteNumber(p?.x) && isFiniteNumber(p?.y))) return null;
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
    obj.set('points', flat);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stroke's points in world coordinates at its current position and size (thickness is not scaled). */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  return out;
}
