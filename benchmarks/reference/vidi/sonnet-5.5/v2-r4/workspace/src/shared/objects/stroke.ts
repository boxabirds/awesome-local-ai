import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin, at the size the stroke was created with. */
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

export function isPenColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, c);
}
export function isPenThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t);
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z)) max = Math.max(max, z);
  });
  return max;
}

/**
 * One stroke in one LOCAL_ORIGIN transaction; the bbox is the points' extent padded by half the thickness.
 * Null (nothing written) for no points, a non-finite coordinate, or an unknown colour or thickness.
 */
export function createStroke(doc: Y.Doc, a: { points: readonly Point[]; color: PenColor; thickness: PenThickness }, by: string): string | null {
  if (!Array.isArray(a.points) || a.points.length === 0 || !isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (!a.points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const pad = PEN_THICKNESS_WORLD[a.thickness] / 2;
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
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + 2 * pad;
  const height = maxY - minY + 2 * pad;
  const flat: number[] = [];
  for (const p of a.points) flat.push(p.x - x, p.y - y);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objects(doc).set(id, obj);
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
  }, LOCAL_ORIGIN);
  return id;
}

/** The stroke's points in board coordinates at its current size (thickness is not scaled). */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  return out;
}
