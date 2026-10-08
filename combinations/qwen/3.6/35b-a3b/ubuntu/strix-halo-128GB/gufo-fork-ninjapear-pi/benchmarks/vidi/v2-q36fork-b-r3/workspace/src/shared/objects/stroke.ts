import * as Y from 'yjs';
import type { Point } from '../../client/canvas/camera';
import { PEN_COLORS, PEN_THICKNESS_WORLD, DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../config';
import type { PenColor, PenThickness } from '../config';
import { simplify, smoothPath } from '../geometry/simplify';
import { LOCAL_ORIGIN } from '../board-model';

/** Internal interface for the raw stroke data stored in Y.Doc. Re-exported as StrokeSnapshot from board-model. */
export interface StrokeData {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  points: readonly number[];       // flattened [x0,y0, x1,y1, ...] relative to bbox origin, at creation size
  baseWidth: number;               // bbox width at creation
  baseHeight: number;              // bbox height at creation
  color: PenColor;
  thickness: PenThickness;
  z: number;
  createdAt: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function getDocObjects(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getMaxZ(objects: any): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a stroke object in the document. Returns null for invalid input.
 * Validates: non-empty points with finite coords, known colour and thickness.
 * Points are simplified using Ramer–Douglas–Peucker then stored relative to bbox origin.
 */
export function createStroke(
  doc: Y.Doc,
  opts: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  _by: string,
): string | null {
  const { points, color, thickness } = opts;

  // Validate colour and thickness
  if (!(color in PEN_COLORS)) return null;
  if (!(thickness in PEN_THICKNESS_WORLD)) return null;

  // Validate points
  if (!points || points.length === 0) return null;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  // Simplify the raw points
  const simplified = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX);
  if (simplified.length === 0) return null;

  const objects = getDocObjects(doc);
  const maxZ = getMaxZ(objects);

  // Compute bounding box (padded by half the thickness)
  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of simplified) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // For a single point (dot), use a square of thickness × thickness
  let bboxW: number;
  let bboxH: number;
  if (simplified.length === 1) {
    bboxW = thicknessWorld;
    bboxH = thicknessWorld;
  } else {
    const padding = thicknessWorld / 2;
    bboxW = (maxX - minX) + thicknessWorld;
    bboxH = (maxY - minY) + thicknessWorld;
  }

  const bboxX = minX - thicknessWorld / 2;
  const bboxY = minY - thicknessWorld / 2;

  // Store points relative to bbox origin
  const relPoints: number[] = [];
  for (const p of simplified) {
    relPoints.push(p.x - bboxX);
    relPoints.push(p.y - bboxY);
  }

  const id = crypto.randomUUID();
  const dataMap = new Y.Map();
  dataMap.set('type', 'stroke');
  dataMap.set('x', bboxX);
  dataMap.set('y', bboxY);
  dataMap.set('width', bboxW);
  dataMap.set('height', bboxH);
  dataMap.set('points', relPoints);
  dataMap.set('baseWidth', bboxW);
  dataMap.set('baseHeight', bboxH);
  dataMap.set('color', color);
  dataMap.set('thickness', thickness);
  dataMap.set('z', maxZ + 1);
  dataMap.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, dataMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Return scaled world-space points for rendering/hit-testing.
 * Scales by current width/baseWidth and height/baseHeight; thickness is NOT scaled.
 */
export function scaledPoints(s: StrokeData): Point[] {
  const scaleX = s.baseWidth !== 0 ? s.width / s.baseWidth : 1;
  const scaleY = s.baseHeight !== 0 ? s.height / s.baseHeight : 1;

  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({
      x: s.points[i] * scaleX,
      y: s.points[i + 1] * scaleY,
    });
  }
  return pts;
}

/** Create an SVG path for this stroke. */
export function strokePath(s: StrokeData): string {
  const pts = scaledPoints(s);
  return smoothPath(pts);
}
