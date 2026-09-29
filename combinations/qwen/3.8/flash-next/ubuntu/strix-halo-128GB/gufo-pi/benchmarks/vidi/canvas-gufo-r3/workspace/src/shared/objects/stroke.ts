import * as Y from 'yjs';
import type { Point } from '@client/canvas/camera';
import { LOCAL_ORIGIN } from '@shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '@shared/config';

export type { PenColor, PenThickness };

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

function maxZAll(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map) {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

/**
 * Validate and create a stroke object on the doc.
 * Returns the new id, or null on invalid input (empty points, non-finite, unknown colour/thickness).
 * One LOCAL_ORIGIN transaction per stroke.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate colour and thickness
  if (!isPenColor(a.color)) return null;
  if (!isPenThickness(a.thickness)) return null;
  // Validate points non-empty
  if (!a.points || a.points.length === 0) return null;
  // Validate all points are finite
  for (const p of a.points) {
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }

  const thicknessWorld = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thicknessWorld / 2;

  let x: number, y: number, width: number, height: number;
  let relPoints: number[];

  if (a.points.length === 1) {
    // Dot: bbox = thickness square, centred on the point
    x = a.points[0].x - pad;
    y = a.points[0].y - pad;
    width = thicknessWorld;
    height = thicknessWorld;
    // Store single point relative to bbox origin: centre
    relPoints = [pad, pad];
  } else {
    // Compute bbox of points, padded by thickness/2
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of a.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    x = minX - pad;
    y = minY - pad;
    width = (maxX - minX) + thicknessWorld;
    height = (maxY - minY) + thicknessWorld;
    // Points relative to bbox origin
    relPoints = [];
    for (const p of a.points) {
      relPoints.push(p.x - x, p.y - y);
    }
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'stroke');
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('points', relPoints);
    m.set('baseWidth', width);
    m.set('baseHeight', height);
    m.set('color', a.color);
    m.set('thickness', a.thickness);
    m.set('z', maxZAll(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Returns the world-space points scaled by current width/baseWidth and height/baseHeight.
 * Thickness is not scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.width / s.baseWidth;
  const scaleY = s.height / s.baseHeight;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({
      x: s.x + s.points[i] * scaleX,
      y: s.y + s.points[i + 1] * scaleY,
    });
  }
  return pts;
}

/** Snapshot all stroke objects from a doc (sorted by z, id). */
export function snapshotStroke(doc: Y.Doc): readonly StrokeSnap[] {
  const result: StrokeSnap[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'stroke') return;
    const x = m.get('x');
    const y = m.get('y');
    const width = m.get('width');
    const height = m.get('height');
    const points = m.get('points');
    const baseWidth = m.get('baseWidth');
    const baseHeight = m.get('baseHeight');
    const color = m.get('color');
    const thickness = m.get('thickness');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    const createdBy = m.get('createdBy');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    if (!isFiniteNumber(width) || !isFiniteNumber(height)) return;
    if (!isFiniteNumber(baseWidth) || !isFiniteNumber(baseHeight)) return;
    if (!Array.isArray(points)) return;
    if (!isPenColor(color) || !isPenThickness(thickness)) return;
    result.push({
      id,
      type: 'stroke',
      x,
      y,
      width,
      height,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      createdBy: typeof createdBy === 'string' ? createdBy : '',
      points: points as number[],
      baseWidth,
      baseHeight,
      color: color as PenColor,
      thickness: thickness as PenThickness,
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
