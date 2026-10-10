// Story 11: the `stroke` object type's model layer. A stroke is immutable
// after creation: points are stored as one flat number array (replaced
// atomically, never edited point by point); only generic x/y/width/height
// change through story 7 move/resize.

import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import { LOCAL_ORIGIN, isPenColor, isPenThickness } from '../board-model';
import type { Point } from '../geometry';

export type { StrokeSnap } from '../board-model';
export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export function maxStrokeZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Creates a stroke from world-space points in the given colour/thickness.
// The bbox is the point range padded by thickness/2 on every side, so a
// single point yields a thickness-by-thickness square (a round dot). Stored
// points are relative to the bbox origin at creation size. Empty, non-finite
// or unknown-option input writes nothing and returns null.
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const { points } = a;
  if (!Array.isArray(points) || points.length === 0) return null;
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  const half = PEN_THICKNESS_WORLD[a.thickness] / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - half;
  const y = minY - half;
  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;

  const flat: number[] = [];
  for (const p of points) flat.push(p.x - x, p.y - y);

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const z = maxStrokeZ(objects) + 1;
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
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// World-space points of a stroke at its current size: stored bbox-relative
// coordinates scaled by width/baseWidth and height/baseHeight. Line
// thickness is intentionally not scaled.
export function scaledPoints(s: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
}): Point[] {
  const sx = (s.width ?? s.baseWidth) / s.baseWidth;
  const sy = (s.height ?? s.baseHeight) / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
