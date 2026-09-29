/**
 * Story 11: the stroke object type (stroke.model).
 *
 * Schema (one entry per object in the `objects` map):
 *   type: 'stroke', x, y, width, height (bbox padded by thickness/2),
 *   points: number[]  // flattened [x0, y0, x1, y1, ...] RELATIVE to the bbox
 *                      // origin, at the creation size — replaced atomically,
 *                      // never edited point-by-point (strokes are immutable
 *                      // after creation)
 *   baseWidth, baseHeight  // bbox size at creation; render scale =
 *                      // width/baseWidth, height/baseHeight, so the story 7
 *                      // aspect-locked resize scales the line without
 *                      // rewriting points (pen.resize)
 *   color: PenColor, thickness: PenThickness
 *
 * Selection (by line distance), move, resize and delete come from the
 * generic story 7 machinery (strokes register in the object registry).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectsOf, type ObjectSnapshot } from '../board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import type { Point } from '../geometry';

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

type ObjectMap = Y.Map<unknown>;

function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && value in PEN_COLORS;
}

function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD;
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Creates a stroke from world-space points (pen.draw / pen.dot / pen.options).
 * Returns the new id, or null (no transaction) for empty points, a non-finite
 * coordinate, an unknown colour or an unknown thickness.
 *
 * The bbox is the points' bbox padded by thickness/2 (a single point → a
 * thickness square centred on it); the points are stored flattened, relative
 * to the bbox origin, at the creation size (baseWidth/baseHeight). One
 * LOCAL_ORIGIN transaction per stroke → one undo step.
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
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX - t / 2;
  const y = minY - t / 2;
  const width = maxX - minX + t;
  const height = maxY - minY + t;

  const rel: number[] = [];
  for (const p of pts) rel.push(p.x - x, p.y - y);

  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', rel);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** The full stroke snapshot from the doc, or undefined for a stale/malformed id. */
export function getStroke(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const obj = objectsOf(doc).get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'stroke') return undefined;
  const points = obj.get('points');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  if (
    !Array.isArray(points) ||
    !points.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
    points.length < 2
  ) {
    return undefined;
  }
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (typeof baseWidth !== 'number' || typeof baseHeight !== 'number') return undefined;
  if (baseWidth <= 0 || baseHeight <= 0) return undefined;
  if (!isPenColor(color) || !isPenThickness(thickness)) return undefined;
  return {
    id,
    type: 'stroke',
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : baseWidth,
    height: typeof height === 'number' && Number.isFinite(height) ? height : baseHeight,
    z: (obj.get('z') as number) ?? 0,
    points,
    baseWidth,
    baseHeight,
    color,
    thickness,
  };
}

/**
 * The stroke's points in CURRENT world coordinates: stored (bbox-relative)
 * points scaled by width/baseWidth × height/baseHeight, offset by x/y.
 * `thickness` is deliberately NOT scaled (pen.resize).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = (s.width ?? s.baseWidth) / s.baseWidth;
  const sy = (s.height ?? s.baseHeight) / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
