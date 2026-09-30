// Pen strokes (story 11): freehand lines, immutable after creation except for the generic
// x/y/width/height (move and resize, story 7). Framework-free.
//
// objects/<id>: Y.Map {
//   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
//   points: number[]   // flattened [x0, y0, x1, y1, ...] relative to the box origin, at creation size
//   baseWidth, baseHeight, color: PenColor, thickness: PenThickness
// }
// The box is the points' bounds padded by half the thickness (a dot: a thickness square). The
// points are drawn scaled by width/baseWidth and height/baseHeight; the thickness never scales.
import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export interface StrokeSnap extends ObjectSnapshot {
  readonly type: 'stroke';
  readonly points: readonly number[];
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: PenColor;
  readonly thickness: PenThickness;
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

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** The stroke-specific fields of a stored stroke; malformed points read as no points. */
export function readStrokeFields(
  obj: Y.Map<unknown>,
  box: { width: number; height: number },
): Pick<StrokeSnap, 'points' | 'baseWidth' | 'baseHeight' | 'color' | 'thickness'> {
  const points = obj.get('points');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  const valid =
    Array.isArray(points) &&
    points.length % 2 === 0 &&
    points.every((v) => typeof v === 'number' && Number.isFinite(v));
  return {
    points: valid ? Object.freeze(points.slice() as number[]) : Object.freeze([]),
    baseWidth: positive(baseWidth) ? baseWidth : box.width,
    baseHeight: positive(baseHeight) ? baseHeight : box.height,
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
  };
}

/**
 * Creates a stroke through world `points` (one point: a round dot) on top of every other object,
 * in one LOCAL_ORIGIN transaction. Returns the new id, or null (nothing written) for no points,
 * a non-finite coordinate, or an unknown colour or thickness.
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
  const objects = doc.getMap('objects');
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : undefined;
      if (typeof z === 'number' && Number.isFinite(z)) maxZ = Math.max(maxZ, z);
    });
    const obj = new Y.Map<unknown>();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('points', flat);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stroke's points in world units at its current position and size. */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
