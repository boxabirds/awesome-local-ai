import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '@/shared/config';
import type { PenColor, PenThickness } from '@/shared/config';
import { simplify, splitPoints, smoothPath } from '@/shared/geometry/simplify';
import type { Point } from '../geometry/types';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { STROKE_SIMPLIFY_TOLERANCE_PX, STROKE_MAX_POINTS } from '@/shared/config';

// ---- Types ----

export interface StrokeSnap {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  points: readonly number[];       // flattened [x0,y0,x1,y1,...] relative to bbox origin at creation size
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  z: number;
  createdBy: string;
  createdAt: number;
}

/** Create a stroke object in the document. Returns id or null on invalid input. */
export function createStroke(
  doc: Y.Doc,
  opts: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  byUserId: string,
): string | null {
  const { points, color, thickness } = opts;

  // Validate points
  if (!points || points.length === 0) return null;
  for (const p of points) {
    if (!isFinite(p.x) || !isFinite(p.y)) return null;
  }

  // Validate colour and thickness
  if (!(color in PEN_COLORS)) return null;
  if (!(thickness in PEN_THICKNESS_WORLD)) return null;

  const objects = doc.getMap('objects');
  const maxZ = getMaxZ(objects);

  // Compute bounding box padded by thickness/2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const halfT = PEN_THICKNESS_WORLD[thickness] / 2;

  // Single point → dot: bbox is exactly thickness square centered on the point
  if (points.length === 1) {
    const s = PEN_THICKNESS_WORLD[thickness];
    return createDotStroke(doc, points[0], s, color, thickness, byUserId, maxZ);
  }

  const id = crypto.randomUUID();

  const bbX = minX - halfT;
  const bbY = minY - halfT;
  const bbW = maxX - minX + halfT * 2;
  const bbH = maxY - minY + halfT * 2;

  // Store points relative to bbox origin at creation size
  const relativePoints: number[] = [];
  for (const p of points) {
    relativePoints.push(p.x - bbX, p.y - bbY);
  }

  doc.transact(() => {
    const inner = new Y.Map() as Y.Map<unknown>;
    setField(inner, 'type', 'stroke');
    setField(inner, 'id', id);
    setField(inner, 'x', bbX);
    setField(inner, 'y', bbY);
    setField(inner, 'width', bbW);
    setField(inner, 'height', bbH);
    setField(inner, 'points', relativePoints);
    setField(inner, 'baseWidth', bbW);
    setField(inner, 'baseHeight', bbH);
    setField(inner, 'color', color);
    setField(inner, 'thickness', thickness);
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdBy', byUserId);
    setField(inner, 'createdAt', Date.now());
    (objects as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

/** Create a stroke from raw world-space points, applying simplification. */
export function createStrokeSimplified(
  doc: Y.Doc,
  points: readonly Point[],
  color: PenColor,
  thickness: PenThickness,
  byUserId: string,
  zoom: number,
): string | null {
  // Check for very long strokes — split into parts
  const parts = splitPoints(points, STROKE_MAX_POINTS);
  const ids: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Simplify with tolerance scaled by zoom (except split parts which need to join seamlessly)
    let simplified: Point[];
    if (i < parts.length - 1 && part.length >= 3) {
      // Splitting: keep all points so they join seamlessly
      simplified = [...part];
    } else if (part.length >= 3) {
      simplified = simplify(part, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    } else {
      simplified = [...part];
    }

    const id = createStroke(doc, { points: simplified, color, thickness }, byUserId);
    if (!id) return null;
    ids.push(id);
  }

  return ids[ids.length - 1] ?? null;
}

/** Get scaled world-space points for rendering/hit-testing at current dimensions. */
export function scaledPoints(s: StrokeSnap): Point[] {
  const pts = s.points;
  const scaleX = s.width / s.baseWidth;
  const scaleY = s.height / s.baseHeight;

  const result: Point[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    result.push({
      x: s.x + pts[i] * scaleX,
      y: s.y + pts[i + 1] * scaleY,
    });
  }
  return result;
}

/** Rendered SVG path data for a stroke snap. */
export function renderPathData(s: StrokeSnap): string {
  return smoothPath(scaledPoints(s));
}

// Create dot stroke for single point case (bbox = thickness square centered on point)
function createDotStroke(
  doc: Y.Doc,
  pt: Point,
  size: number,
  color: PenColor,
  thickness: PenThickness,
  byUserId: string,
  maxZ: number,
): string | null {
  const objects = doc.getMap('objects');
  const id = crypto.randomUUID();

  doc.transact(() => {
    const inner = new Y.Map() as Y.Map<unknown>;
    setField(inner, 'type', 'stroke');
    setField(inner, 'id', id);
    setField(inner, 'x', pt.x - size / 2);
    setField(inner, 'y', pt.y - size / 2);
    setField(inner, 'width', size);
    setField(inner, 'height', size);
    // Single point relative to bbox origin
    setField(inner, 'points', [size / 2, size / 2]);
    setField(inner, 'baseWidth', size);
    setField(inner, 'baseHeight', size);
    setField(inner, 'color', color);
    setField(inner, 'thickness', thickness);
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdBy', byUserId);
    setField(inner, 'createdAt', Date.now());
    (objects as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

// ---- Helpers ----

function getObjectsMap(doc: Y.Doc): unknown {
  return doc.getMap('objects');
}

function getField(inner: any, key: string): any {
  try {
    return inner.get(key);
  } catch {
    return undefined;
  }
}

function setField(inner: any, key: string, val: any): void {
  inner.set(key, val);
}

function getMaxZ(objects: unknown): number {
  let max = 0;
  const objMap = objects as Y.Map<unknown>;
  (objMap as any).forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(getField(inner, 'z'));
      if (z > max) max = z;
    }
  });
  return max;
}
