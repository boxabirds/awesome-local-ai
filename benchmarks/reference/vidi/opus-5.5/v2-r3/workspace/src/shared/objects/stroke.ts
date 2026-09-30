// Freehand strokes (story 11, stroke.model). Framework-free like board-model.
//
// objects/<id>: Y.Map {
//   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
//   points: number[]   // flattened [x0, y0, x1, y1, ...] relative to (x, y) at creation size
//   baseWidth, baseHeight, color: PenColor, thickness: PenThickness
// }
// A stroke is immutable after creation: `points` is written once as a plain
// array; moves and resizes only change x/y/width/height (story 7).
import * as Y from 'yjs';
import {
  getObjectsMap,
  isFiniteNumber,
  LOCAL_ORIGIN,
  maxZ,
  registerModelType,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';

export const STROKE_TYPE = 'stroke';

export type { PenColor, PenThickness };

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  createdBy: string;
}

const HALF = 2;

export function isPenColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, c);
}

export function isPenThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t);
}

export function isStroke(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === STROKE_TYPE;
}

function readPoints(v: unknown): readonly number[] {
  if (!Array.isArray(v) || v.length < HALF || v.length % HALF !== 0) return [];
  if (!v.every(isFiniteNumber)) return [];
  return Object.freeze(v.slice() as number[]);
}

function readStroke(base: ObjectSnapshot, obj: Y.Map<unknown>): StrokeSnap {
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const createdBy = obj.get('createdBy');
  return {
    ...base,
    type: 'stroke',
    points: readPoints(obj.get('points')),
    baseWidth: isFiniteNumber(baseWidth) && baseWidth > 0 ? baseWidth : base.width,
    baseHeight: isFiniteNumber(baseHeight) && baseHeight > 0 ? baseHeight : base.height,
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

registerModelType(STROKE_TYPE, readStroke);

/**
 * Adds a finished stroke on top of every object in one LOCAL_ORIGIN
 * transaction. Its box is the points' bounds padded by half the thickness (a
 * single point is a dot: a thickness-sized square). Returns the id, or null
 * with nothing written for no points, a non-finite coordinate, or an unknown
 * colour or thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  const pts = a.points;
  if (!Array.isArray(pts) || pts.length === 0) return null;
  if (!pts.every((p) => p && isFiniteNumber(p.x) && isFiniteNumber(p.y))) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const t = PEN_THICKNESS_WORLD[a.thickness];
  const x = minX - t / HALF;
  const y = minY - t / HALF;
  const width = maxX - minX + t;
  const height = maxY - minY + t;
  const flat: number[] = [];
  for (const p of pts) flat.push(p.x - x, p.y - y);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', STROKE_TYPE);
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
    getObjectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's points in world units at its current position and size: stored
 * points scaled by width/baseWidth and height/baseHeight. Thickness is not scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += HALF) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
