import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke'; points: readonly number[]; baseWidth: number; baseHeight: number; color: PenColor; thickness: PenThickness;
}

const HALF = 2;
const has = (o: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const isPenColor = (c: unknown): c is PenColor => has(PEN_COLORS, c);
export const isPenThickness = (t: unknown): t is PenThickness => has(PEN_THICKNESS_WORLD, t);

const objectsOf = (doc: Y.Doc) => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

/** Returns the new id, or null (nothing written) for no points, a non-finite point, or an unknown colour/thickness. */
export function createStroke(
  doc: Y.Doc, a: { points: readonly Point[]; color: PenColor; thickness: PenThickness }, by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (!Array.isArray(a.points) || a.points.length === 0) return null;
  if (!a.points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const t = PEN_THICKNESS_WORLD[a.thickness];
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of a.points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const ox = x0 - t / HALF;
  const oy = y0 - t / HALF;
  const width = x1 - x0 + t;
  const height = y1 - y0 + t;
  const flat: number[] = [];
  a.points.forEach((p) => flat.push(p.x - ox, p.y - oy));
  const id = crypto.randomUUID();
  doc.transact(() => {
    let max = 0;
    objectsOf(doc).forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : 0;
      if (typeof z === 'number') max = Math.max(max, z);
    });
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'stroke');
    obj.set('x', ox); obj.set('y', oy); obj.set('width', width); obj.set('height', height);
    obj.set('z', max + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('points', flat);
    obj.set('baseWidth', width); obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stored points scaled to the stroke's current width/height, relative to its top-left corner. */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = (s.width ?? s.baseWidth) / s.baseWidth;
  const sy = (s.height ?? s.baseHeight) / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) out.push({ x: s.points[i] * sx, y: s.points[i + 1] * sy });
  return out;
}
