/**
 * Stroke object model: schema helpers for the 'stroke' object type.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections return null before opening a transaction, so no update event is emitted.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../local-origin';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../../client/canvas/camera';

const VALID_COLORS = new Set<string>(Object.keys(PEN_COLORS));
const VALID_THICKNESSES = new Set<string>(Object.keys(PEN_THICKNESS_WORLD));

export interface StrokeSnap {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  z: number;
  createdAt: number;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Create a stroke object from recorded world-space points.
 *
 * Returns the new id, or null when:
 * - points is empty
 * - any coordinate is not finite
 * - colour is not in PEN_COLORS
 * - thickness is not in PEN_THICKNESS_WORLD
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  _by: string,
): string | null {
  // Validate colour and thickness
  if (!VALID_COLORS.has(a.color)) return null;
  if (!VALID_THICKNESSES.has(a.thickness)) return null;

  // Validate points
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thickness / 2;

  // Compute bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // For a single point (dot): bbox = thickness × thickness square
  let bboxX: number, bboxY: number, bboxW: number, bboxH: number;
  if (a.points.length === 1) {
    bboxW = thickness;
    bboxH = thickness;
    bboxX = a.points[0]!.x - thickness / 2;
    bboxY = a.points[0]!.y - thickness / 2;
  } else {
    // Pad bbox by thickness/2 on each side
    bboxX = minX - pad;
    bboxY = minY - pad;
    bboxW = (maxX - minX) + thickness;
    bboxH = (maxY - minY) + thickness;
  }

  // Store points relative to bbox origin
  const flatPoints: number[] = [];
  for (const p of a.points) {
    flatPoints.push(p.x - bboxX, p.y - bboxY);
  }

  const objects = objectsMap(doc);
  const id = crypto.randomUUID();

  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'stroke');
    obj.set('x', bboxX);
    obj.set('y', bboxY);
    obj.set('width', bboxW);
    obj.set('height', bboxH);
    obj.set('points', flatPoints);
    obj.set('baseWidth', bboxW);
    obj.set('baseHeight', bboxH);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Scale the stored points to the current width/height.
 * Returns world-space points suitable for rendering and hit-testing.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const scaleX = s.baseWidth !== 0 ? s.width / s.baseWidth : 1;
  const scaleY = s.baseHeight !== 0 ? s.height / s.baseHeight : 1;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({
      x: s.x + (s.points[i]!) * scaleX,
      y: s.y + (s.points[i + 1]!) * scaleY,
    });
  }
  return pts;
}

/** Read a stroke object from the Y.Map. Returns null if type !== 'stroke'. */
export function readStroke(id: string, obj: Y.Map<unknown>): StrokeSnap | null {
  if (obj.get('type') !== 'stroke') return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const points = obj.get('points');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');

  return {
    id,
    type: 'stroke',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
    points: Array.isArray(points) ? points : [],
    baseWidth: typeof baseWidth === 'number' ? baseWidth : 1,
    baseHeight: typeof baseHeight === 'number' ? baseHeight : 1,
    color: VALID_COLORS.has(String(color)) ? (color as PenColor) : 'black',
    thickness: VALID_THICKNESSES.has(String(thickness)) ? (thickness as PenThickness) : 'medium',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}
