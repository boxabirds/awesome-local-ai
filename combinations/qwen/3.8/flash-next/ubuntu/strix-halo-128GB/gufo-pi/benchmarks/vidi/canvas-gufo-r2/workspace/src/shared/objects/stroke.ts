/**
 * Stroke object model (story 11).
 *
 * Schema: type 'stroke', x, y, width, height, z, createdAt, createdBy,
 *         points: number[] (flattened [x0,y0,x1,y1,...] relative to bbox origin),
 *         baseWidth, baseHeight, color: PenColor, thickness: PenThickness
 */
import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

const VALID_COLORS: ReadonlySet<string> = new Set(Object.keys(PEN_COLORS));
const VALID_THICKNESS: ReadonlySet<string> = new Set(Object.keys(PEN_THICKNESS_WORLD));

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Create a stroke object from world-space points.
 * Returns the new id, or null on invalid input (empty, non-finite, unknown colour/thickness).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate points
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  // Validate colour and thickness
  if (!VALID_COLORS.has(a.color)) return null;
  if (!VALID_THICKNESS.has(a.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];

  // Compute bbox of the points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  let bboxX: number, bboxY: number, bboxW: number, bboxH: number;

  if (a.points.length === 1) {
    // Single point: dot with thickness as diameter, centred at the point
    bboxW = thickness;
    bboxH = thickness;
    bboxX = a.points[0].x - thickness / 2;
    bboxY = a.points[0].y - thickness / 2;
  } else {
    // Pad bbox by thickness/2
    bboxX = minX - thickness / 2;
    bboxY = minY - thickness / 2;
    bboxW = (maxX - minX) + thickness;
    bboxH = (maxY - minY) + thickness;
  }

  // Store points relative to bbox origin
  const flatPoints: number[] = [];
  for (const p of a.points) {
    flatPoints.push(p.x - bboxX, p.y - bboxY);
  }

  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;

  doc.transact(() => {
    if (objects.has(id)) return;
    const yMap = new Y.Map();
    objects.set(id, yMap);
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
    yMap.set('z', z);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', by);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Compute world-space points from a stroke snapshot, scaled by current size / base size.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const scaleY = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const result: Point[] = [];
  const pts = s.points;
  for (let i = 0; i < pts.length; i += 2) {
    result.push({
      x: s.x + pts[i] * scaleX,
      y: s.y + pts[i + 1] * scaleY,
    });
  }
  return result;
}
