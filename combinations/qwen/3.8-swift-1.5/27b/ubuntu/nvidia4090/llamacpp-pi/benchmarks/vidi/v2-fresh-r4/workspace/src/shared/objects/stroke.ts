/**
 * Stroke object model (story 11): schema helpers for `type: 'stroke'` objects.
 *
 * Schema (Y.Map per object under the `objects` map):
 *   type: 'stroke', x, y, width, height (bbox padded by thickness/2),
 *   points: number[] (flattened [x0,y0,x1,y1,...] relative to bbox origin, at creation size),
 *   baseWidth, baseHeight (bbox size at creation),
 *   color: PenColor, thickness: PenThickness, z, createdAt
 *
 * Strokes are immutable after creation; only x/y/width/height change on
 * move/resize (story 7 generic behaviour).
 */
import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** Stroke object snapshot (story 11). */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/** Type guard for stroke snapshots. */
export function isStrokeSnapshot(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === 'stroke';
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isValidPenColor(c: string): c is PenColor {
  return c in PEN_COLORS;
}

function isValidPenThickness(t: string): t is PenThickness {
  return t in PEN_THICKNESS_WORLD;
}

/**
 * Create a new stroke object from world-space points.
 * Returns the new id, or null for invalid input (no transaction).
 * One LOCAL_ORIGIN transaction on success.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate points
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isFinitePair(p.x, p.y)) return null;
  }

  // Validate colour and thickness
  if (!isValidPenColor(a.color)) return null;
  if (!isValidPenThickness(a.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const halfT = thickness / 2;

  // Compute bounding box of the points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Pad by thickness/2
  const bboxX = minX - halfT;
  const bboxY = minY - halfT;
  let bboxW = maxX - minX + thickness;
  let bboxH = maxY - minY + thickness;

  // Single point: bbox is a thickness square
  if (a.points.length === 1) {
    bboxW = thickness;
    bboxH = thickness;
  }

  // Store points relative to bbox origin
  const relPoints: number[] = [];
  for (const p of a.points) {
    relPoints.push(p.x - bboxX, p.y - bboxY);
  }

  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();
  const stroke = new Y.Map<unknown>();
  stroke.set('type', 'stroke');
  stroke.set('x', bboxX);
  stroke.set('y', bboxY);
  stroke.set('width', bboxW);
  stroke.set('height', bboxH);
  stroke.set('points', relPoints);
  stroke.set('baseWidth', bboxW);
  stroke.set('baseHeight', bboxH);
  stroke.set('color', a.color);
  stroke.set('thickness', a.thickness);
  stroke.set('z', maxZ + 1);
  stroke.set('createdAt', Date.now());
  stroke.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, stroke);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale the stored (bbox-relative) points to the current width/height.
 * Returns world-space points.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const scaleY = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;

  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({
      x: s.x + s.points[i] * scaleX,
      y: s.y + s.points[i + 1] * scaleY,
    });
  }
  return pts;
}
