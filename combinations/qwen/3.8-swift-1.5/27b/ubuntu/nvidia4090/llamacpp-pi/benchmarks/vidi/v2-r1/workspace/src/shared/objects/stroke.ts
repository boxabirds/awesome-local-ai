/**
 * Story 11: stroke object model.
 *
 * Schema (per object id in the `objects` Y.Map):
 * ```
 * Y.Map {
 *   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *   points: number[],   // flattened [x0, y0, x1, y1, ...] relative to the
 *                       // bbox origin, at creation size
 *   baseWidth, baseHeight, // bbox size at creation; render scale =
 *                       // width/baseWidth, height/baseHeight
 *   color: PenColor, thickness: PenThickness
 * }
 * ```
 *
 * Points are stored as a plain number array (replaced atomically, never
 * edited point-by-point) because strokes are immutable after creation;
 * only the generic x/y/width/height change on move/resize.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import type { Point } from '../geometry';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin at creation size. */
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/** Cast a generic snapshot to its stroke flavour. */
export function asStroke(snap: ObjectSnapshot): StrokeSnap {
  return snap as StrokeSnap;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isValidColor(value: unknown): value is PenColor {
  return typeof value === 'string' && value in PEN_COLORS;
}

function isValidThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD;
}

/**
 * Create a finished stroke from world-space points.
 *
 * - The bbox is the points' bbox padded by thickness/2 on every side
 *   (a single point → a thickness-square bbox: a round dot).
 * - Points are stored flattened, relative to the padded bbox origin.
 * - One LOCAL_ORIGIN transaction (one undo step, PRD pen long-stroke
 *   parts each get their own).
 * - Empty points, any non-finite coordinate, unknown colour or
 *   thickness → null with no transaction.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const { points, color, thickness } = a;
  if (!isValidColor(color) || !isValidThickness(thickness)) return null;
  if (!Array.isArray(points) || points.length === 0) return null;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  const t = PEN_THICKNESS_WORLD[thickness];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - t / 2;
  const y = minY - t / 2;
  const width = maxX - minX + t;
  const height = maxY - minY + t;

  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', 'stroke');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('points', flat);
  obj.set('baseWidth', width);
  obj.set('baseHeight', height);
  obj.set('color', color);
  obj.set('thickness', thickness);
  obj.set('z', getMaxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * World-space points of a stroke scaled to its CURRENT width/height
 * (proportional resize): stored points multiplied by width/baseWidth
 * and height/baseHeight. The thickness is never scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const pts = s.points;
  const out: Point[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push({ x: s.x + pts[i] * sx, y: s.y + pts[i + 1] * sy });
  }
  return out;
}
