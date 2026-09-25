/**
 * Freehand pen strokes (story 11).
 *
 *   objects/<id>: Y.Map {
 *     type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *     points: number[]            // flattened [x0, y0, x1, y1, ...] relative to the box's top-left, at creation size
 *     baseWidth, baseHeight       // box size at creation; drawn scale = width / baseWidth, height / baseHeight
 *     color: PenColor, thickness: PenThickness
 *   }
 *
 * The box is the points' bounding box padded by half the thickness on every side (a dot is a
 * thickness-sized square). Strokes are immutable after creation: `points` is a plain array that
 * is never edited; moving and resizing change only the generic x/y/width/height (story 7), so a
 * resize scales the drawn line while the thickness stays the same.
 */
import * as Y from 'yjs';
import { PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../config';
import {
  isPenColor,
  isPenThickness,
  LOCAL_ORIGIN,
  maxZ,
  STROKE_TYPE,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

export { STROKE_TYPE, isPenColor, isPenThickness, type PenColor, type PenThickness };

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  width: number;
  height: number;
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

export function isStroke(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === STROKE_TYPE && obj.points !== undefined && obj.thickness !== undefined;
}

const HALF = 2;

/**
 * Adds a finished stroke (one LOCAL_ORIGIN transaction) above every other object and returns
 * its id. One point makes a round dot whose diameter is the thickness. Null, with no
 * transaction, for no points, any non-finite coordinate, or an unknown colour or thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const { points } = a;
  if (points.length === 0) return null;
  if (!points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  const pad = PEN_THICKNESS_WORLD[a.thickness] / HALF;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + pad * HALF;
  const height = maxY - minY + pad * HALF;
  const flat: number[] = [];
  for (const p of points) flat.push(p.x - x, p.y - y);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    const z = maxZ(doc) + 1;
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
    obj.set('type', STROKE_TYPE);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('points', flat);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stroke's points relative to its box's top-left, scaled to its current size. */
export function scaledLocalPoints(s: StrokeSnap): Point[] {
  const sx = s.width / s.baseWidth;
  const sy = s.height / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += HALF) out.push({ x: s.points[i]! * sx, y: s.points[i + 1]! * sy });
  return out;
}

/**
 * The stroke's points in world units at its current position and size (for drawing and hit
 * testing). The thickness is not scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  return scaledLocalPoints(s).map((p) => ({ x: s.x + p.x, y: s.y + p.y }));
}
