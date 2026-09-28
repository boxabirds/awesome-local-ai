import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

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
  text: string; // for union compatibility
}

const COLOR_KEYS: Set<string> = new Set(Object.keys(PEN_COLORS));
const THICKNESS_KEYS: Set<string> = new Set(Object.keys(PEN_THICKNESS_WORLD));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/**
 * Create a stroke object from world-space points.
 * Returns the new id, or null if input is invalid (empty, non-finite, unknown colour/thickness).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate
  if (!a.points || a.points.length === 0) return null;
  if (!COLOR_KEYS.has(a.color)) return null;
  if (!THICKNESS_KEYS.has(a.thickness)) return null;

  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  const thicknessWorld = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thicknessWorld / 2;

  // Compute bbox of points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  let bboxX: number, bboxY: number, bboxW: number, bboxH: number;

  if (a.points.length === 1) {
    // Dot: bbox = thickness square centred on point
    bboxW = thicknessWorld;
    bboxH = thicknessWorld;
    bboxX = a.points[0].x - pad;
    bboxY = a.points[0].y - pad;
  } else {
    // Pad bbox by thickness/2
    bboxX = minX - pad;
    bboxY = minY - pad;
    bboxW = (maxX - minX) + thicknessWorld;
    bboxH = (maxY - minY) + thicknessWorld;
  }

  // Store points relative to bbox origin
  const flatPoints: number[] = [];
  for (const p of a.points) {
    flatPoints.push(p.x - bboxX, p.y - bboxY);
  }

  const id = crypto.randomUUID();
  const objects = objectsMap(doc);

  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });
    const yMap = new Y.Map<unknown>();
    yMap.set('type', 'stroke');
    yMap.set('x', bboxX);
    yMap.set('y', bboxY);
    yMap.set('width', bboxW);
    yMap.set('height', bboxH);
    yMap.set('points', flatPoints);
    yMap.set('baseWidth', bboxW);
    yMap.set('baseHeight', bboxH);
    yMap.set('color', a.color);
    yMap.set('thickness', a.thickness);
    yMap.set('z', maxZ + 1);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', by);
    objects.set(id, yMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale stored points to the current width/height.
 * Returns world-space points.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.width / s.baseWidth;
  const sy = s.height / s.baseHeight;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({
      x: s.x + s.points[i] * sx,
      y: s.y + s.points[i + 1] * sy,
    });
  }
  return pts;
}
