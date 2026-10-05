import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import type { Point } from '../geometry';

/**
 * Stroke objects (story 11): freehand pen strokes. A stroke is created once
 * (its points are immutable afterwards) and then only moved/resized/deleted
 * through the generic story 7 operations on x/y/width/height.
 *
 * Schema: common fields (x, y, width, height = bbox padded by thickness/2)
 * plus `points` (flattened [x0, y0, x1, y1, ...] relative to the bbox origin,
 * at the creation size), `baseWidth`/`baseHeight` (the bbox size at creation;
 * render scale = width/baseWidth, height/baseHeight), `color` and
 * `thickness` (named settings).
 */
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
  return typeof value === 'string' && value in PEN_COLORS;
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Creates a finished stroke from world-space points. Returns the new id, or
 * null (no transaction) for empty points, any non-finite coordinate, or an
 * unknown colour/thickness name (invalid input is discarded silently).
 *
 * The bbox is the points' extent padded by half the thickness; a single
 * point becomes a round dot whose bbox is the thickness square. Points are
 * stored relative to the bbox origin at the creation size. One LOCAL_ORIGIN
 * transaction (one undo step).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const pts = a.points;
  if (!pts || pts.length === 0) return null;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  if (!isPenColor(a.color)) return null;
  if (!isPenThickness(a.thickness)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];
  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (pts.length === 1) {
    // Dot: bbox = thickness square centred on the point.
    x = pts[0].x - t / 2;
    y = pts[0].y - t / 2;
    width = t;
    height = t;
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    x = minX - t / 2;
    y = minY - t / 2;
    width = maxX - minX + t;
    height = maxY - minY + t;
  }

  const id = crypto.randomUUID();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'stroke');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('points', pts.flatMap((p) => [p.x - x, p.y - y]));
  obj.set('baseWidth', width);
  obj.set('baseHeight', height);
  obj.set('color', a.color);
  obj.set('thickness', a.thickness);
  obj.set('createdBy', by);
  obj.set('z', maxZ(doc) + 1);
  obj.set('createdAt', Date.now());

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's world-space points at the current size: stored (relative)
 * points scaled by width/baseWidth and height/baseHeight. The thickness is
 * never scaled — it stays the stored value.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const out: Point[] = [];
  const w = s.width ?? s.baseWidth;
  const h = s.height ?? s.baseHeight;
  const sx = s.baseWidth > 0 ? w / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? h / s.baseHeight : 1;
  const pts = s.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push({ x: s.x + pts[i] * sx, y: s.y + pts[i + 1] * sy });
  }
  return out;
}
