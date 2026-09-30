/**
 * Stroke object model (story 11, stroke.model).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *     points: number[],      // flattened [x0, y0, x1, y1, ...] relative to the
 *                            // bbox origin, at creation size
 *     baseWidth, baseHeight, // bbox size at creation; render scale =
 *                            // width / baseWidth, height / baseHeight
 *     color: PenColor, thickness: PenThickness
 *   }
 *
 * Strokes are immutable after creation: `points` is replaced atomically, never
 * edited point-by-point. Only x/y/width/height change (move/resize).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, registerKnownType, type ObjectSnapshot } from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  width: number;
  height: number;
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin at creation size. */
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

// Worker-safe shared model: mark 'stroke' known so objectSnapshot emits it
// even where the client registry is not imported (unit tests, worker).
registerKnownType('stroke');

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function isValidPoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Creates a stroke from world-space points in the given colour and thickness.
 *
 * - One point → a round dot: bbox is a thickness×thickness square centred on
 *   the point, stored as a single (relative) point.
 * - Several points → bbox of the points padded by thickness/2.
 *
 * Points are stored relative to the bbox origin at creation size, with
 * baseWidth/baseHeight recording that size so `scaledPoints` can render at
 * the current (resized) width/height.
 *
 * Returns the new id, or null (with no transaction) for empty points, any
 * non-finite coordinate, or an unknown colour / thickness name. One
 * LOCAL_ORIGIN transaction per stroke.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string
): string | null {
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isValidPoint(p)) return null;
  }
  if (!(a.color in PEN_COLORS)) return null;
  if (!(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];

  let x: number, y: number, width: number, height: number;
  let rel: Point[];

  if (a.points.length === 1) {
    // Dot: thickness square centred on the point.
    const p = a.points[0];
    width = thickness;
    height = thickness;
    x = p.x - thickness / 2;
    y = p.y - thickness / 2;
    rel = [{ x: thickness / 2, y: thickness / 2 }];
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of a.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    width = maxX - minX + thickness;
    height = maxY - minY + thickness;
    x = minX - thickness / 2;
    y = minY - thickness / 2;
    rel = a.points.map((p) => ({ x: p.x - x, y: p.y - y }));
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('points', rel.flatMap((p) => [p.x, p.y]));
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * World-space points of a stroke at its current (resized) size: stored
 * relative points scaled by width/baseWidth and height/baseHeight, offset to
 * the current bbox origin. Thickness is never scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width / s.baseWidth) : 1;
  const sy = s.baseHeight > 0 ? (s.height / s.baseHeight) : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}

/**
 * Read a stroke object from the doc as a StrokeSnap, or null when the id is
 * stale or the fields are invalid.
 */
export function strokeFromMap(doc: Y.Doc, id: string): StrokeSnap | null {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'stroke') return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const z = obj.get('z');
  const width = obj.get('width');
  const height = obj.get('height');
  const points = obj.get('points');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  if (
    typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
    typeof width !== 'number' || typeof height !== 'number' ||
    typeof baseWidth !== 'number' || typeof baseHeight !== 'number' ||
    !Array.isArray(points) || points.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
    typeof color !== 'string' || !(color in PEN_COLORS) ||
    typeof thickness !== 'string' || !(thickness in PEN_THICKNESS_WORLD)
  ) {
    return null;
  }
  return {
    id,
    type: 'stroke',
    x,
    y,
    z,
    width,
    height,
    points: points as number[],
    baseWidth,
    baseHeight,
    color: color as PenColor,
    thickness: thickness as PenThickness,
  };
}
