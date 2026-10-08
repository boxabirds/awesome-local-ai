import * as Y from 'yjs';
import type { Point } from '../geometry';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';

// Types
export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** Stroke snapshot emitted by snapshot(). */
export interface StrokeSnap {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  points: readonly number[];       // flattened [x0,y0,x1,y1,...] relative to bbox origin at creation size
  baseWidth: number;               // bbox width at creation
  baseHeight: number;              // bbox height at creation
  color: PenColor;
  thickness: PenThickness;
}

/** Validate a colour name against PEN_COLORS. */
function isValidColor(color: string): color is PenColor {
  return color in PEN_COLORS;
}

/** Validate a thickness name against PEN_THICKNESS_WORLD. */
function isValidThickness(thickness: string): thickness is PenThickness {
  return thickness in PEN_THICKNESS_WORLD;
}

/** Check that all points are finite numbers. */
function isFinitePoints(points: readonly Point[]): boolean {
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

/** Compute world-space bounding box from points, padded by half the thickness. */
function computeBbox(
  points: readonly Point[],
  thickness: PenThickness,
): { x: number; y: number; width: number; height: number } {
  const half = PEN_THICKNESS_WORLD[thickness] / 2;

  if (points.length === 1) {
    // Dot: bbox is a square of `thickness` side, centred on the point
    return {
      x: points[0].x - half,
      y: points[0].y - half,
      width: PEN_THICKNESS_WORLD[thickness],
      height: PEN_THICKNESS_WORLD[thickness],
    };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX - half,
    y: minY - half,
    width: (maxX + half) - (minX - half),
    height: (maxY + half) - (minY - half),
  };
}

/** Store points relative to bbox origin. */
function relPoints(pts: readonly Point[], bboxOrigin: { x: number; y: number }): number[] {
  const flat: number[] = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    flat[i * 2] = pts[i].x - bboxOrigin.x;
    flat[i * 2 + 1] = pts[i].y - bboxOrigin.y;
  }
  return flat;
}

/**
 * Create a stroke object in the Y.Doc.
 * @returns object id on success, null on validation failure (no transaction).
 */
export function createStroke(
  doc: Y.Doc,
  opts: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const { points, color, thickness } = opts;

  // Validation: non-empty
  if (!points || points.length === 0) return null;

  // Validation: all finite
  if (!isFinitePoints(points)) return null;

  // Validation: known colour
  if (!isValidColor(color)) return null;

  // Validation: known thickness
  if (!isValidThickness(thickness)) return null;

  // Compute bbox
  const bbox = computeBbox(points, thickness);
  const { x: bx, y: by_, width: bw, height: bh } = bbox;

  // Points relative to bbox origin
  const rel = relPoints(points, { x: bx, y: by_ });

  // Get next z
  const objects = doc.getMap('objects') as Y.Map<Y.Map<any>>;
  let maxZ = 0;
  objects.forEach((v) => {
    const z = v.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();

  doc.transact(() => {
    const map = new Y.Map();
    map.set('type', 'stroke');
    map.set('x', bx);
    map.set('y', by_);
    map.set('width', bw);
    map.set('height', bh);
    map.set('z', maxZ + 1);
    map.set('points', rel);
    map.set('baseWidth', bw);
    map.set('baseHeight', bh);
    map.set('color', color);
    map.set('thickness', thickness);
    map.set('createdBy', by);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Given a StrokeSnap, scale the stored points to match the current width/height.
 * Returns world-space points scaled proportionally; thickness does not change.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  // Handle both raw snapshot objects (with flat number[] points) and Y.Map objects (via .get())
  const hasGet = typeof (s as any).get === 'function';
  const width = hasGet ? ((s as any).get('width') ?? 0) : (s.width ?? 0);
  const height = hasGet ? ((s as any).get('height') ?? 0) : (s.height ?? 0);
  const baseWidth = hasGet ? ((s as any).get('baseWidth') ?? 0) : (s.baseWidth ?? 0);
  const baseHeight = hasGet ? ((s as any).get('baseHeight') ?? 0) : (s.baseHeight ?? 0);
  const ox = hasGet ? ((s as any).get('x') ?? 0) : (s.x ?? 0);
  const oy = hasGet ? ((s as any).get('y') ?? 0) : (s.y ?? 0);
  const rawPoints = hasGet ? ((s as any).get('points') as number[]) : (s.points as number[]);

  if (!rawPoints || !(rawPoints instanceof Array)) return [];
  if (baseWidth <= 0 || baseHeight <= 0) return [];

  const scaleX = width / baseWidth;
  const scaleY = height / baseHeight;

  const pts: Point[] = new Array(rawPoints.length / 2);
  for (let i = 0; i < pts.length; i++) {
    pts[i] = {
      x: rawPoints[i * 2] * scaleX + ox,
      y: rawPoints[i * 2 + 1] * scaleY + oy,
    };
  }
  return pts;
}
