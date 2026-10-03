/**
 * Stroke object model (story 11, stroke.model).
 *
 * A `stroke` object is a freehand drawing:
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *   points: number[],   // flattened [x0, y0, x1, y1, ...] relative to bbox origin
 *   baseWidth: number,  // bbox width at creation
 *   baseHeight: number, // bbox height at creation
 *   color: PenColor,
 *   thickness: PenThickness
 * }
 * ```
 *
 * Points are stored relative to the bbox origin at creation size.
 * `scaledPoints` multiplies by the current width/baseWidth ratio to
 * produce world-space points for rendering and hit testing.
 *
 * Selection, move, resize, delete and undo are the generic story 7/8
 * operations; nothing stroke-specific is added there.
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

/** Immutable snapshot of a stroke object. */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Create a stroke from world-space points.
 *
 * - Validates points (non-empty, all finite), colour and thickness names.
 * - Computes the bounding box padded by thickness/2.
 * - Stores points relative to the bbox origin, plus baseWidth/baseHeight.
 * - One point → dot: bbox = thickness square.
 * - Invalid input → null, no transaction.
 *
 * One LOCAL_ORIGIN transaction per success. Returns the new id.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate points
  if (!a.points || a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }

  // Validate colour and thickness
  if (!(a.color in PEN_COLORS)) return null;
  if (!(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const halfThickness = thickness / 2;

  // Compute the bounding box of the points
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

  // For a single point (dot), the bbox is a thickness square
  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (minX === maxX && minY === maxY) {
    // Dot: bbox = thickness square centred on the point
    x = minX - halfThickness;
    y = minY - halfThickness;
    width = thickness;
    height = thickness;
  } else {
    // Pad the points bbox by halfThickness on each side
    x = minX - halfThickness;
    y = minY - halfThickness;
    width = maxX - minX + thickness;
    height = maxY - minY + thickness;
  }

  // Store points relative to the bbox origin
  const relPoints: number[] = [];
  for (const p of a.points) {
    relPoints.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const objectsMap = getObjects(doc);

  let maxZ = 0;
  objectsMap.forEach((obj) => {
    const z = obj.get('z') as number;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const obj = new Y.Map();
  obj.set('type', 'stroke');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  obj.set('points', relPoints);
  obj.set('baseWidth', width);
  obj.set('baseHeight', height);
  obj.set('color', a.color);
  obj.set('thickness', a.thickness);

  doc.transact(() => {
    objectsMap.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale the stored relative points to the current width/height.
 * Returns world-space points (absolute coordinates).
 *
 * The scale factors are width/baseWidth and height/baseHeight.
 * Thickness is NOT scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const w = s.width ?? s.baseWidth;
  const h = s.height ?? s.baseHeight;
  const sx = s.baseWidth > 0 ? w / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? h / s.baseHeight : 1;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({
      x: s.x + s.points[i] * sx,
      y: s.y + s.points[i + 1] * sy,
    });
  }
  return pts;
}
