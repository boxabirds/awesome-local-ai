/**
 * Stroke object model: schema helpers for creating freehand strokes.
 *
 * Schema per stroke:
 *   objects/<id>: Y.Map {
 *     type: 'stroke', x, y, width, height, z, createdAt,
 *     points: number[] (flattened [x0,y0,x1,y1,...] relative to bbox origin, at creation size),
 *     baseWidth, baseHeight (bbox size at creation),
 *     color: PenColor, thickness: PenThickness
 *   }
 */

import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const COLOR_KEYS = new Set<string>(Object.keys(PEN_COLORS));
const THICKNESS_KEYS = new Set<string>(Object.keys(PEN_THICKNESS_WORLD));

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/** Largest `z` currently in use across all objects (0 for an empty board). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsMap(doc).values()) {
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * Validate a point array: must be non-empty, all coordinates finite.
 */
function validatePoints(points: readonly Point[]): boolean {
  if (!points || points.length === 0) return false;
  for (const p of points) {
    if (!isFiniteNumber(p?.x) || !isFiniteNumber(p?.y)) return false;
  }
  return true;
}

/**
 * Create a stroke object from world-space points.
 *
 * - Validates: non-empty, all finite, colour in PEN_COLORS, thickness in PEN_THICKNESS_WORLD.
 * - Single point: creates a dot with bbox = thickness x thickness.
 * - Multiple points: computes bbox padded by thickness/2; stores points relative to bbox origin.
 * - Returns new id or null on invalid input (no transaction).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  _by: string,
): string | null {
  // Validate colour
  if (!COLOR_KEYS.has(a.color)) return null;
  // Validate thickness
  if (!THICKNESS_KEYS.has(a.thickness)) return null;
  // Validate points
  if (!validatePoints(a.points)) return null;

  const thicknessVal = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thicknessVal / 2;

  let x: number, y: number, width: number, height: number;
  let relPoints: number[];

  if (a.points.length === 1) {
    // Single point → dot: bbox is thickness x thickness centred on the point
    const pt = a.points[0]!;
    width = thicknessVal;
    height = thicknessVal;
    x = pt.x - pad;
    y = pt.y - pad;
    // Store point relative to bbox origin: it's at the center
    relPoints = [pad, pad];
  } else {
    // Compute bbox from all points, then pad by thickness/2
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of a.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    x = minX - pad;
    y = minY - pad;
    width = (maxX - minX) + thicknessVal;
    height = (maxY - minY) + thicknessVal;
    // Points relative to bbox origin
    relPoints = [];
    for (const p of a.points) {
      relPoints.push(p.x - x, p.y - y);
    }
  }

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'stroke');
    map.set('x', x);
    map.set('y', y);
    map.set('width', width);
    map.set('height', height);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('points', relPoints);
    map.set('baseWidth', width);
    map.set('baseHeight', height);
    map.set('color', a.color);
    map.set('thickness', a.thickness);
    objectsMap(doc).set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale stored points to current object size.
 * Returns world-space points for rendering and hit testing.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const scaleY = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const result: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    result.push({
      x: s.x + (s.points[i] ?? 0) * scaleX,
      y: s.y + (s.points[i + 1] ?? 0) * scaleY,
    });
  }
  return result;
}

/**
 * Read a stroke snapshot from the doc for a given id.
 */
export function readStrokeSnapshot(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'stroke') return undefined;
  return strokeFromMap(id, map);
}

/** Build a StrokeSnap from a Y.Map (used in allObjectsSnapshot). */
export function strokeFromMap(id: string, map: Y.Map<unknown>): StrokeSnap | undefined {
  const rawPoints = map.get('points');
  const color = map.get('color');
  const thickness = map.get('thickness');
  if (!Array.isArray(rawPoints)) return undefined;
  if (typeof color !== 'string' || !COLOR_KEYS.has(color)) return undefined;
  if (typeof thickness !== 'string' || !THICKNESS_KEYS.has(thickness)) return undefined;

  const x = isFiniteNumber(map.get('x')) ? (map.get('x') as number) : 0;
  const y = isFiniteNumber(map.get('y')) ? (map.get('y') as number) : 0;
  const width = isFiniteNumber(map.get('width')) ? (map.get('width') as number) : 1;
  const height = isFiniteNumber(map.get('height')) ? (map.get('height') as number) : 1;
  const baseWidth = isFiniteNumber(map.get('baseWidth')) ? (map.get('baseWidth') as number) : width;
  const baseHeight = isFiniteNumber(map.get('baseHeight')) ? (map.get('baseHeight') as number) : height;
  const z = isFiniteNumber(map.get('z')) ? (map.get('z') as number) : 0;

  return {
    id,
    type: 'stroke',
    x,
    y,
    width,
    height,
    z,
    points: rawPoints as number[],
    baseWidth,
    baseHeight,
    color: color as PenColor,
    thickness: thickness as PenThickness,
  };
}
