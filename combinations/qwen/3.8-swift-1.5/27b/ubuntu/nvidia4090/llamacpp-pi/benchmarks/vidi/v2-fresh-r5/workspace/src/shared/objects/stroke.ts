/**
 * Stroke object model (story 11). Schema helpers for creating freehand
 * strokes in the Y.Doc. Strokes are immutable after creation: points are
 * stored relative to the bbox origin at creation size, and only the generic
 * x/y/width/height change on move/resize (pen.resize).
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
} from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import type { ObjectSnapshot } from '../board-model';

/** Immutable snapshot of a stroke object for rendering. */
export interface StrokeSnap extends Omit<ObjectSnapshot, 'type' | 'color'> {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin, at creation size. */
  points: readonly number[];
  /** Bbox size at creation; render scale = width/baseWidth, height/baseHeight. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

function isValidColor(color: string): color is PenColor {
  return color in PEN_COLORS;
}

function isValidThickness(thickness: string): thickness is PenThickness {
  return thickness in PEN_THICKNESS_WORLD;
}

/**
 * Create a new stroke in the document from world-space points.
 *
 * Validates that points are non-empty and finite and that colour/thickness
 * are known names; returns null (with no transaction) otherwise. The bbox is
 * the points' extent padded by thickness/2 (a single point yields a
 * thickness-sized square, i.e. a dot). One LOCAL_ORIGIN transaction.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate points: non-empty, all finite
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isFiniteCoord(p.x) || !isFiniteCoord(p.y)) return null;
  }
  // Validate colour and thickness names
  if (!isValidColor(a.color)) return null;
  if (!isValidThickness(a.thickness)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];

  // Bbox of the points, padded by thickness/2 (a single point → t×t square)
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
  const x = minX - t / 2;
  const y = minY - t / 2;
  const width = maxX - minX + t;
  const height = maxY - minY + t;

  // Flatten points relative to the bbox origin (at creation size)
  const flat: number[] = [];
  for (const p of a.points) {
    flat.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const strokeMap = new Y.Map<unknown>();
  strokeMap.set('type', 'stroke');
  strokeMap.set('x', x);
  strokeMap.set('y', y);
  strokeMap.set('width', width);
  strokeMap.set('height', height);
  strokeMap.set('points', flat);
  strokeMap.set('baseWidth', width);
  strokeMap.set('baseHeight', height);
  strokeMap.set('color', a.color);
  strokeMap.set('thickness', a.thickness);
  strokeMap.set('z', maxZ + 1);
  strokeMap.set('createdAt', Date.now());
  void by; // identity recorded by the sync layer; strokes need no per-user field

  doc.transact(() => {
    objects.set(id, strokeMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * World-space points of a stroke scaled to its current size. The stored
 * points are relative to the bbox origin at creation size; they are scaled
 * by width/baseWidth and height/baseHeight and translated to the current
 * origin. Thickness is NOT scaled (pen.resize).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return pts;
}
