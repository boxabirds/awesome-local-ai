import * as Y from 'yjs';
import { LOCAL_ORIGIN, type StrokeSnapshot } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../config';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };
export type StrokeSnap = StrokeSnapshot;

const HALF = 2;
const hasKey = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Creates a stroke through `points` (world space) in one transaction. The bounding box is padded by half the
 * thickness; points are stored flattened relative to its origin. Null (nothing written) for no points, a
 * non-finite coordinate, or an unknown colour or thickness.
 */
export function createStroke(
  doc: Y.Doc, a: { points: readonly Point[]; color: PenColor; thickness: PenThickness }, by: string,
): string | null {
  if (a.points.length === 0) return null;
  if (!hasKey(PEN_COLORS, a.color) || !hasKey(PEN_THICKNESS_WORLD, a.thickness)) return null;
  if (!a.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const pad = PEN_THICKNESS_WORLD[a.thickness] / HALF;
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
  const width = maxX - minX + pad * HALF;
  const height = maxY - minY + pad * HALF;
  const flat: number[] = [];
  for (const p of a.points) flat.push(p.x - x, p.y - y);
  const objects = doc.getMap('objects') as Y.Map<unknown>;
  let z = 0;
  objects.forEach((o) => {
    const v = o instanceof Y.Map ? o.get('z') : 0;
    if (typeof v === 'number' && Number.isFinite(v)) z = Math.max(z, v);
  });
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objects.set(id, m);
    m.set('type', 'stroke');
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('points', flat);
    m.set('baseWidth', width);
    m.set('baseHeight', height);
    m.set('color', a.color);
    m.set('thickness', a.thickness);
    m.set('z', z + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stored points scaled to the stroke's current width and height, relative to the bbox origin shifted to x, y. */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += HALF) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
