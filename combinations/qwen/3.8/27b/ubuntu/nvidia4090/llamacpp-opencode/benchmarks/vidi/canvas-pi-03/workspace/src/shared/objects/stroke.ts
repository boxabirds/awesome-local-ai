import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '@/shared/config';
import { LOCAL_ORIGIN, ensureMeta, type ObjectSnapshot } from '@/shared/board-model';
import { registerKnownObjectType } from '@/shared/known-object-types';
import type { Point } from '@/shared/geometry';

// The stroke model marks its type known (sel.all_types). The call is safe at
// module scope: known-object-types.ts is dependency-free (see its header).
registerKnownObjectType('stroke');

/** Pen ink swatch names (keys of PEN_COLORS). */
export type PenColor = keyof typeof PEN_COLORS;

/** Pen thickness names (keys of PEN_THICKNESS_WORLD; world units). */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/**
 * A stroke object snapshot (type guard: isStrokeSnap).
 *
 * `points` are flattened [x0, y0, x1, y1, ...] RELATIVE to the bbox origin,
 * at the creation size (baseWidth x baseHeight). `width`/`height` are the
 * bbox padded by half the thickness; the render/hit scale is
 * width/baseWidth, height/baseHeight, so proportional resize (story 7)
 * changes the geometry without ever rewriting the points (pen.resize).
 * Strokes are immutable after creation: only x/y/width/height change on
 * move/resize (the points array is replaced atomically, never edited).
 */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** The bbox is always present and finite on a well-formed stroke. */
  width: number;
  height: number;
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

export function isStrokeSnap(o: ObjectSnapshot): o is StrokeSnap {
  if (o.type !== 'stroke') return false;
  return (
    typeof o.width === 'number' && Number.isFinite(o.width) && o.width >= 0 &&
    typeof o.height === 'number' && Number.isFinite(o.height) && o.height >= 0 &&
    Array.isArray(o.points) &&
    o.points.length >= 2 &&
    o.points.length % 2 === 0 &&
    o.points.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    typeof o.baseWidth === 'number' && Number.isFinite(o.baseWidth) && o.baseWidth > 0 &&
    typeof o.baseHeight === 'number' && Number.isFinite(o.baseHeight) && o.baseHeight > 0 &&
    typeof o.color === 'string' && o.color in PEN_COLORS &&
    typeof o.thickness === 'string' && o.thickness in PEN_THICKNESS_WORLD
  );
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function strokeObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'stroke') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Creates a finished stroke from world-space points (pen.draw, pen.dot).
 *
 * The bbox is the points' bounds padded by half the thickness (a single
 * point is a round dot: a thickness x thickness square centred on it).
 * Points are stored relative to the bbox origin at the creation size, with
 * baseWidth/baseHeight recording that size. z = maxZ + 1; exactly one
 * LOCAL_ORIGIN transaction.
 *
 * Rejects (returns null, no transaction): empty points, any non-finite
 * coordinate, unknown colour or thickness name.
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
  if (typeof a.color !== 'string' || !(a.color in PEN_COLORS)) return null;
  if (typeof a.thickness !== 'string' || !(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];
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
  const x = minX - t / 2;
  const y = minY - t / 2;
  // width = (maxX - minX) + t: a single point (dot) becomes a t x t square.
  const width = maxX - minX + t;
  const height = maxY - minY + t;
  const points: number[] = [];
  for (const p of a.points) {
    points.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    ensureMeta(doc);
    const all = objectsMap(doc);
    const obj = new Y.Map();
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
    obj.set('z', maxZ(all) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    all.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Reads a stroke object as a typed snapshot. Unknown stored colour/thickness
 * names fall back to the defaults (a future/removed swatch never crashes the
 * renderer). Returns undefined for a stale id or malformed fields.
 */
export function readStroke(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const obj = strokeObj(doc, id);
  if (!obj) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const points = obj.get('points');
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof width !== 'number' || typeof height !== 'number' ||
    typeof baseWidth !== 'number' || typeof baseHeight !== 'number' ||
    baseWidth <= 0 || baseHeight <= 0 ||
    !Array.isArray(points) || points.length < 2 || points.length % 2 !== 0
  ) {
    return undefined;
  }
  for (const v of points) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  }
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  const createdBy = obj.get('createdBy');
  return {
    id,
    type: 'stroke',
    x,
    y,
    width,
    height,
    points,
    baseWidth,
    baseHeight,
    color: typeof color === 'string' && color in PEN_COLORS ? (color as PenColor) : DEFAULT_PEN_COLOR,
    thickness:
      typeof thickness === 'string' && thickness in PEN_THICKNESS_WORLD
        ? (thickness as PenThickness)
        : DEFAULT_PEN_THICKNESS,
    z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    ...(typeof createdBy === 'string' ? { createdBy } : {}),
  };
}

/**
 * The stroke's WORLD-space points at its current size: stored relative
 * points scaled by width/baseWidth and height/baseHeight (proportional
 * resize never rewrites the points; the thickness is NOT scaled —
 * pen.resize).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  const pts = s.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push({ x: s.x + pts[i] * sx, y: s.y + pts[i + 1] * sy });
  }
  return out;
}
