import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';

/**
 * Stroke (freehand pen) object model (story 11).
 *
 * Points are stored as a flattened number array [x0, y0, x1, y1, ...] relative
 * to the bbox origin, at creation size. The `baseWidth`/`baseHeight` record the
 * bbox size at creation; proportional resize scales the path without rewriting
 * points, and `scaledPoints()` multiplies by the current ratio.
 */

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to bbox origin. */
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

const VALID_COLORS = new Set<string>(Object.keys(PEN_COLORS));
const VALID_THICKNESSES = new Set<string>(Object.keys(PEN_THICKNESS_WORLD));

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/**
 * Create a stroke object from world-space points.
 *
 * Returns null and writes nothing when:
 * - points array is empty or contains non-finite values
 * - colour is not in PEN_COLORS
 * - thickness is not in PEN_THICKNESS_WORLD
 *
 * A single point creates a "dot": a bbox that is a thickness square with the
 * point at the centre.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  _by: string,
): string | null {
  // Validate
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  if (!VALID_COLORS.has(a.color)) return null;
  if (!VALID_THICKNESSES.has(a.thickness)) return null;

  const thicknessWorld = PEN_THICKNESS_WORLD[a.thickness];
  const half = thicknessWorld / 2;

  let x0: number;
  let y0: number;
  let width: number;
  let height: number;

  if (a.points.length === 1) {
    // Dot: bbox is a thickness-square centred on the point.
    const p = a.points[0]!;
    x0 = p.x - half;
    y0 = p.y - half;
    width = thicknessWorld;
    height = thicknessWorld;
  } else {
    // Compute bounding box of points, padded by half thickness.
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
    x0 = minX - half;
    y0 = minY - half;
    width = maxX - minX + thicknessWorld;
    height = maxY - minY + thicknessWorld;
  }

  // Store points relative to bbox origin.
  const flatPoints: number[] = [];
  for (const p of a.points) {
    flatPoints.push(p.x - x0, p.y - y0);
  }

  const objects = getObjects(doc);
  const id = crypto.randomUUID();

  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z');
      if (typeof z === 'number' && z > maxZ) maxZ = z;
    });
    const map = new Y.Map<unknown>();
    map.set('type', 'stroke');
    map.set('x', x0);
    map.set('y', y0);
    map.set('width', width);
    map.set('height', height);
    map.set('z', maxZ + 1);
    map.set('points', flatPoints);
    map.set('baseWidth', width);
    map.set('baseHeight', height);
    map.set('color', a.color);
    map.set('thickness', a.thickness);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale the stored points to the current width/height. Used for rendering and
 * hit testing after a proportional resize changes width/height without rewriting
 * points. Thickness is NOT scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth === 0 ? 1 : s.width! / s.baseWidth;
  const scaleY = s.baseHeight === 0 ? 1 : s.height! / s.baseHeight;
  const result: Point[] = [];
  for (let i = 0; i < s.points.length - 1; i += 2) {
    result.push({
      x: (s.points[i]! ?? 0) * scaleX,
      y: (s.points[i + 1]! ?? 0) * scaleY,
    });
  }
  return result;
}

/**
 * Parse a stored stroke map into a StrokeSnap. Returns null for malformed data.
 */
export function strokeSnapshotFrom(
  id: string,
  z: number,
  map: Y.Map<unknown>,
): StrokeSnap | null {
  const x = map.get('x');
  const y = map.get('y');
  const width = map.get('width');
  const height = map.get('height');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const points = map.get('points');
  if (!Array.isArray(points)) return null;
  const baseWidth = map.get('baseWidth');
  const baseHeight = map.get('baseHeight');
  if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight)) return null;
  const color = map.get('color');
  const thickness = map.get('thickness');
  if (typeof color !== 'string' || !VALID_COLORS.has(color)) return null;
  if (typeof thickness !== 'string' || !VALID_THICKNESSES.has(thickness)) return null;

  return {
    id,
    type: 'stroke',
    x: x as number,
    y: y as number,
    z,
    width: width as number,
    height: height as number,
    points: points as readonly number[],
    baseWidth: baseWidth as number,
    baseHeight: baseHeight as number,
    color: color as PenColor,
    thickness: thickness as PenThickness,
  };
}
