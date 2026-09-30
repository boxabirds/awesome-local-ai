import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '@shared/config';
import { LOCAL_ORIGIN, _registerTypeForModel } from '@shared/board-model';
import type { Point } from '@shared/geometry';

// Register 'stroke' type with board-model
_registerTypeForModel('stroke');

const VALID_COLORS = new Set<string>(Object.keys(PEN_COLORS));
const VALID_THICKNESSES = new Set<string>(Object.keys(PEN_THICKNESS_WORLD));

export interface StrokeSnap {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/**
 * Create a stroke object from recorded world-space points.
 * Returns the new id, or null on invalid input (no transaction is made on null).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  _by: string,
): string | null {
  // Validate points array is non-empty
  if (!a.points || a.points.length === 0) return null;

  // Validate all points are finite
  for (const pt of a.points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  }

  // Validate color and thickness
  if (!VALID_COLORS.has(a.color)) return null;
  if (!VALID_THICKNESS(a.thickness)) return null;

  const thicknessPx = PEN_THICKNESS_WORLD[a.thickness];
  const halfT = thicknessPx / 2;

  // Compute bounding box of points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of a.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  // Pad by thickness/2
  const bboxX = minX - halfT;
  const bboxY = minY - halfT;
  const bboxW = (maxX - minX) + thicknessPx;
  const bboxH = (maxY - minY) + thicknessPx;

  // For single point (dot): bbox is a thickness-sized square centered on the point
  if (a.points.length === 1) {
    // Already handled by the formula above: width = 0 + thickness, height = 0 + thickness
  }

  // Store points relative to bbox origin
  const flatPoints: number[] = [];
  for (const pt of a.points) {
    flatPoints.push(pt.x - bboxX);
    flatPoints.push(pt.y - bboxY);
  }

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'stroke');
    obj.set('x', bboxX);
    obj.set('y', bboxY);
    obj.set('width', bboxW);
    obj.set('height', bboxH);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', _by);
    obj.set('points', flatPoints);
    obj.set('baseWidth', bboxW);
    obj.set('baseHeight', bboxH);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

function VALID_THICKNESS(t: string): boolean {
  return VALID_THICKNESSES.has(t);
}

/**
 * Get the scaled world-space points for a stroke snapshot.
 * Scales by current width/baseWidth and height/baseHeight.
 * Thickness is NOT scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const scaleY = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length - 1; i += 2) {
    pts.push({
      x: s.x + s.points[i] * scaleX,
      y: s.y + s.points[i + 1] * scaleY,
    });
  }
  return pts;
}

/**
 * Snapshot a stroke object from the doc's objects map.
 */
export function snapshotStroke(id: string, obj: Y.Map<unknown>): StrokeSnap | null {
  if (obj.get('type') !== 'stroke') return null;
  const points = obj.get('points') as readonly number[];
  if (!points || !Array.isArray(points)) return null;
  return {
    id,
    type: 'stroke',
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    z: (obj.get('z') as number) ?? 0,
    createdAt: (obj.get('createdAt') as number) ?? 0,
    createdBy: (obj.get('createdBy') as string) ?? '',
    points,
    baseWidth: obj.get('baseWidth') as number,
    baseHeight: obj.get('baseHeight') as number,
    color: obj.get('color') as PenColor,
    thickness: obj.get('thickness') as PenThickness,
  };
}
