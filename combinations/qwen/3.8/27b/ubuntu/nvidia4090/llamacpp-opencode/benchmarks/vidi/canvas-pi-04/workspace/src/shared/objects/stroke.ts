// Story 11: the stroke object model (anchor: stroke.model).
//
// A stroke is a freehand line: a list of world points (already RDP-simplified
// by the Pen tool before commit), a colour and a thickness. Strokes are
// IMMUTABLE after creation — the point list is never edited point-by-point.
// Move/resize use the shared story 7 geometry (x/y/width/height); the points
// are stored relative to the bbox origin at the creation size, and
// `scaledPoints` re-derives them at the current size so a proportional resize
// changes the drawn line without rewriting it (pen.resize).
//
// All mutations follow the story 7/9/10 conventions: invalid input is
// rejected with null and NO transaction; a successful mutation is exactly one
// LOCAL_ORIGIN transaction; missing ids are rejected, never silently reused.

import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN, objectMap, type ObjectSnapshot } from '../board-model';

/** Immutable view of one stroke, as rendered by React. */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin, creation size. */
  points: readonly number[];
  /** Bbox width at creation (render scale = width / baseWidth). */
  baseWidth: number;
  /** Bbox height at creation (render scale = height / baseHeight). */
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  /** Epoch ms. */
  createdAt: number;
  createdBy: string;
}

export interface StrokeCreateInput {
  /** World-space points (the Pen tool passes them already simplified). */
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && value in PEN_COLORS;
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** z = maxZ + 1 (1 when the board is empty). */
function nextZ(map: Y.Map<Y.Map<unknown>>): number {
  let z = 1;
  for (const obj of map.values()) {
    const existing = asNumber(obj.get('z'), 0);
    if (existing >= z) z = existing + 1;
  }
  return z;
}

/**
 * Create a stroke from world points (pen.draw / pen.dot) and return its new
 * id.
 *
 * - the bbox is the point extent padded by half the thickness on every side;
 *   a single point is therefore a square of side `thickness` (pen.dot);
 * - the points are stored relative to the bbox origin at the creation size,
 *   plus `baseWidth`/`baseHeight`, so `scaledPoints` re-derives them on
 *   resize (pen.resize);
 * - invalid input (empty points, a non-finite coordinate, an unknown colour
 *   or thickness name) is rejected with null and NO transaction (error paths).
 */
export function createStroke(doc: Y.Doc, input: StrokeCreateInput, by: string): string | null {
  const points = input.points;
  if (points.length === 0) return null;
  for (const p of points) {
    if (!isFinitePoint(p)) return null;
  }
  if (!isPenColor(input.color)) return null;
  if (!isPenThickness(input.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[input.thickness];
  const half = thickness / 2;

  // Point extent, then pad by half the thickness on every side.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - half;
  const y = minY - half;
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;

  // Store relative to the bbox origin, flattened.
  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'stroke');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('points', flat);
  obj.set('baseWidth', width);
  obj.set('baseHeight', height);
  obj.set('color', input.color);
  obj.set('thickness', input.thickness);
  obj.set('z', nextZ(objectMap(doc)));
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  doc.transact(
    () => {
      objectMap(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * The stroke's drawn points at its CURRENT size, in bbox-relative world units
 * (the origin is the bbox top-left, the axes scale by width/baseWidth and
 * height/baseHeight). The thickness is not scaled (pen.resize). Used for both
 * rendering (smoothPath) and the line-distance hit test (pen.select).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const flat = s.points;
  const width = s.width ?? 0;
  const height = s.height ?? 0;
  const sx = s.baseWidth !== 0 ? width / s.baseWidth : 1;
  const sy = s.baseHeight !== 0 ? height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ x: flat[i] * sx, y: flat[i + 1] * sy });
  }
  return out;
}

/** The snapshot of one stroke read straight from the objects map, or undefined. */
export function strokeSnapshot(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'stroke') return undefined;
  const rawPoints = obj.get('points');
  const points: number[] = [];
  if (Array.isArray(rawPoints)) {
    for (const v of rawPoints) {
      if (typeof v === 'number' && Number.isFinite(v)) points.push(v);
    }
  }
  const baseWidth = asNumber(obj.get('baseWidth'), 0);
  const baseHeight = asNumber(obj.get('baseHeight'), 0);
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  const createdBy = obj.get('createdBy');
  return {
    id,
    type: 'stroke',
    x: asNumber(obj.get('x'), 0),
    y: asNumber(obj.get('y'), 0),
    z: asNumber(obj.get('z'), 0),
    width: asNumber(obj.get('width'), 0),
    height: asNumber(obj.get('height'), 0),
    points,
    baseWidth,
    baseHeight,
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
    createdAt: asNumber(obj.get('createdAt'), 0),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}
