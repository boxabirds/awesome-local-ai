import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  width: number;
  height: number;
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin, at creation size. */
  points: readonly number[];
  /** Bbox size at creation; render scale = width/baseWidth, height/baseHeight. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  getObjects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isValidPenColor(c: string): c is PenColor {
  return c in PEN_COLORS;
}

function isValidPenThickness(t: string): t is PenThickness {
  return t in PEN_THICKNESS_WORLD;
}

/**
 * Creates a stroke object from world-space points in a single LOCAL_ORIGIN
 * transaction. The bbox is the points' bounds padded by thickness/2 (a single
 * point is a thickness-sized square dot). Points are stored relative to the
 * bbox origin at the creation size (baseWidth/baseHeight). Returns the new
 * id, or null (no transaction) for empty/non-finite points or an unknown
 * colour/thickness.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  if (!isValidPenColor(a.color)) return null;
  if (!isValidPenThickness(a.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const half = thickness / 2;

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

  const x = minX - half;
  const y = minY - half;
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;

  const points: number[] = [];
  for (const p of a.points) {
    points.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', points);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', z);
    obj.set('createdBy', by);
    getObjects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * The stroke's points scaled to its current width/height, in absolute world
 * coordinates. The thickness is not scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  if (s.baseWidth <= 0 || s.baseHeight <= 0) return [];
  const sx = s.width / s.baseWidth;
  const sy = s.height / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
