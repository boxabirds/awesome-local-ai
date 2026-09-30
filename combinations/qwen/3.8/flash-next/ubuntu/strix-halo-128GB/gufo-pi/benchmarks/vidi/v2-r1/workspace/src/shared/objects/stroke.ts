/**
 * Stroke (freehand drawing) model for story 11.
 *
 * Schema addition:
 *   stroke: common fields (x, y, width, height = bbox padded by thickness/2)
 *           + points: number[]      // flattened [x0, y0, x1, y1, ...] relative to bbox origin, at creation size
 *           + baseWidth, baseHeight // bbox size at creation; render scale = width/baseWidth, height/baseHeight
 *           + color: PenColor, thickness: PenThickness
 */

import * as Y from 'yjs';

import {
  isPenColor,
  isPenThickness,
  type PenColor,
  type PenThickness,
} from '../config';
import { LOCAL_ORIGIN, type Point, type ObjectSnapshot } from '../board-model';
import { PEN_THICKNESS_WORLD } from '../config';

/** Snapshot for stroke objects. */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/**
 * Create a stroke from world-space points. Returns the new object id, or null
 * if the input is invalid (empty, non-finite, unknown colour/thickness).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  _by: string,
): string | null {
  // Validate inputs
  if (!Array.isArray(a.points) || a.points.length === 0) return null;
  if (!isPenColor(a.color)) return null;
  if (!isPenThickness(a.thickness)) return null;

  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  const thicknessWorld = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thicknessWorld / 2;

  // Compute bbox of the raw points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Padded bbox
  const bboxX = minX - pad;
  const bboxY = minY - pad;
  let bboxW = (maxX - minX) + thicknessWorld;
  let bboxH = (maxY - minY) + thicknessWorld;

  // Single-point dot: bbox is thickness square
  if (a.points.length === 1) {
    bboxW = thicknessWorld;
    bboxH = thicknessWorld;
  }

  // Ensure minimum size (avoid zero-width/height in edge cases)
  if (bboxW < 1) bboxW = 1;
  if (bboxH < 1) bboxH = 1;

  // Store points relative to bbox origin
  const flatPoints: number[] = [];
  for (const p of a.points) {
    flatPoints.push(p.x - bboxX, p.y - bboxY);
  }

  const id = crypto.randomUUID();
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

  // Find max z
  let maxZ = 0;
  for (const entry of objects.values()) {
    const z = entry instanceof Y.Map ? entry.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > maxZ) maxZ = z;
  }

  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'stroke');
    entry.set('x', bboxX);
    entry.set('y', bboxY);
    entry.set('width', bboxW);
    entry.set('height', bboxH);
    entry.set('z', maxZ + 1);
    entry.set('createdAt', Date.now());
    entry.set('points', flatPoints);
    entry.set('baseWidth', bboxW);
    entry.set('baseHeight', bboxH);
    entry.set('color', a.color);
    entry.set('thickness', a.thickness);
    objects.set(id, entry);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale the stored points from creation size to current width/height.
 * Thickness is NOT scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const scaleY = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length - 1; i += 2) {
    pts.push({ x: s.points[i] * scaleX, y: s.points[i + 1] * scaleY });
  }
  return pts;
}
