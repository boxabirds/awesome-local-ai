/**
 * Stroke object model (story 11).
 * Schema helpers: create, read, scaledPoints.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getObjectsMap } from '../board-model';
import type { Point } from '../geometry';
import type { PenColor, PenThickness } from '../config';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../config';
import type { BaseObjectSnapshot } from '../board-model';

export interface StrokeSnap extends BaseObjectSnapshot {
  type: 'stroke';
  width: number;
  height: number;
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function isValidColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, c);
}

function isValidThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Create a stroke object from world-space points.
 * Returns the new id, or null on invalid input (no transaction performed).
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate points
  if (!a.points || a.points.length === 0) return null;
  for (const p of a.points) {
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }

  // Validate colour and thickness
  if (!isValidColor(a.color)) return null;
  if (!isValidThickness(a.thickness)) return null;

  const thicknessWorld = PEN_THICKNESS_WORLD[a.thickness];
  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();

  // Compute bbox padded by thickness/2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const halfT = thicknessWorld / 2;
  const bboxX = minX - halfT;
  const bboxY = minY - halfT;
  let bboxW = (maxX - minX) + thicknessWorld;
  let bboxH = (maxY - minY) + thicknessWorld;

  // For a single point (dot): bbox = thickness square
  if (a.points.length === 1) {
    bboxW = thicknessWorld;
    bboxH = thicknessWorld;
  }

  // Store points relative to bbox origin
  const flatPoints: number[] = [];
  for (const p of a.points) {
    flatPoints.push(p.x - bboxX, p.y - bboxY);
  }

  // Compute z = maxZ + 1
  let z = 0;
  for (const m of objects.values()) {
    const zv = m.get('z');
    if (typeof zv === 'number' && zv > z) z = zv;
  }
  z += 1;

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'stroke');
    m.set('x', bboxX);
    m.set('y', bboxY);
    m.set('width', bboxW);
    m.set('height', bboxH);
    m.set('points', flatPoints);
    m.set('baseWidth', bboxW);
    m.set('baseHeight', bboxH);
    m.set('color', a.color);
    m.set('thickness', a.thickness);
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale stored points to current width/height (for rendering and hit testing).
 * Returns world-space points.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.width / s.baseWidth;
  const sy = s.height / s.baseHeight;
  const result: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    result.push({
      x: s.x + s.points[i] * sx,
      y: s.y + s.points[i + 1] * sy,
    });
  }
  return result;
}

/**
 * Read a stroke from a Y.Map into a StrokeSnap (used by snapshot()).
 */
export function readStroke(id: string, m: Y.Map<unknown>): StrokeSnap | null {
  if (m.get('type') !== 'stroke') return null;

  const x = m.get('x');
  const y = m.get('y');
  const width = m.get('width');
  const height = m.get('height');
  const z = m.get('z');
  const points = m.get('points');
  const baseWidth = m.get('baseWidth');
  const baseHeight = m.get('baseHeight');
  const color = m.get('color');
  const thickness = m.get('thickness');
  const createdAt = m.get('createdAt');

  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (!isFiniteNumber(z)) return null;
  if (!isFiniteNumber(baseWidth) || baseWidth <= 0 || !isFiniteNumber(baseHeight) || baseHeight <= 0) return null;
  if (!isValidColor(color)) return null;
  if (!isValidThickness(thickness)) return null;

  // Points should be an array of numbers
  if (!Array.isArray(points)) return null;
  const flat: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    flat.push(v);
  }
  if (flat.length === 0 || flat.length % 2 !== 0) return null;

  return {
    id,
    type: 'stroke',
    x,
    y,
    width,
    height,
    z,
    points: flat,
    baseWidth,
    baseHeight,
    color,
    thickness,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}
