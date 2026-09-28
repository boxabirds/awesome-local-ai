// The freehand stroke object model (story 11, pen.*): Yjs schema helpers
// for the pen's finished strokes.
//
// Schema (objects/<id>):
//   type: 'stroke'
//   x, y: number            // top-left, world units (bbox padded by thickness/2)
//   width, height: number   // world units (bbox size at creation = baseWidth/Height)
//   z: number               // stacking; higher is on top
//   createdAt: number       // epoch ms
//   createdBy: string       // client identity of the creator
//   points: number[]        // flattened [x0, y0, x1, y1, ...] RELATIVE to the
//                           // bbox origin, at the creation (base) size;
//                           // replaced atomically, never edited point-by-point
//   baseWidth, baseHeight: number  // bbox size at creation; render scale =
//                           // width/baseWidth, height/baseHeight
//   color: PenColor         // key of PEN_COLORS
//   thickness: PenThickness // key of PEN_THICKNESS_WORLD
//
// Strokes are IMMUTABLE after creation: only the generic x/y/width/height
// change (move/resize via the story 7 group ops), and scaling the bbox
// scales the line proportionally without touching `points` or thickness
// (pen.resize).
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
// rejections (empty/non-finite points, unknown colour/thickness) return null
// before opening a transaction. Never throws for user-driven input.

import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../config';
import { LOCAL_ORIGIN, maxZ, objectsMap, registerBoardType, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';
import { distanceToPolyline } from '../geometry/polyline';

export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

const STROKE_TYPE = 'stroke';

// Register the type with the board schema lazily: the board-model ↔
// object-module import cycle means a module-load-time registration would run
// before KNOWN_TYPES is initialised (TDZ). Every public entry point ensures
// registration first, which is equally good for snapshots/select-all.
function ensureType(): void {
  registerBoardType(STROKE_TYPE);
}

/** Public registration seam: the CLIENT bundle calls this at module load
 *  (via the object registry) so every client knows the type BEFORE the
 *  first remote stroke arrives — objectsSnapshot filters unknown types,
 *  and a client that never created a stroke locally would otherwise render
 *  remote strokes as invisible. */
export function ensureStrokeType(): void {
  ensureType();
}

/** Snapshot of one stroke object (generic ObjectSnapshot with a CONCRETE
 *  PenColor; the generic snapshot's color stays StickyColor-typed so
 *  sticky/selection code is unaffected). */
export interface StrokeSnap extends Omit<ObjectSnapshot, 'color'> {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function newId(): string {
  return crypto.randomUUID();
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function finitePoints(points: readonly Point[]): boolean {
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

function strokeEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  return entry instanceof Y.Map && entry.get('type') === STROKE_TYPE ? entry : undefined;
}

/**
 * Creates a finished stroke from world-space `points` and returns its new
 * id.
 *
 * - The bbox is the points' bounds padded by thickness/2 on every side; a
 *   single point becomes a thickness×thickness square centred on the point
 *   (pen.dot).
 * - Points are stored flattened and RELATIVE to the bbox origin at the
 *   creation (base) size; `scaledPoints` rescales them with the current
 *   width/height (pen.resize).
 *
 * Empty points, a non-finite coordinate, an unknown colour or thickness
 * name is rejected with null and no transaction (pen.* error paths).
 * Exactly one LOCAL_ORIGIN transaction on success.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  ensureType();
  if (a.points.length === 0) return null;
  if (!finitePoints(a.points)) return null;
  if (typeof a.color !== 'string' || !(a.color in PEN_COLORS)) return null;
  if (typeof a.thickness !== 'string' || !(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];
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

  const flat: number[] = [];
  for (const p of a.points) {
    flat.push(p.x - x, p.y - y);
  }

  const entry = new Y.Map<unknown>();
  entry.set('type', STROKE_TYPE);
  entry.set('x', x);
  entry.set('y', y);
  entry.set('width', width);
  entry.set('height', height);
  entry.set('z', maxZ(doc) + 1);
  entry.set('createdAt', Date.now());
  entry.set('createdBy', by);
  entry.set('points', flat);
  entry.set('baseWidth', width);
  entry.set('baseHeight', height);
  entry.set('color', a.color);
  entry.set('thickness', a.thickness);
  const id = newId();
  doc.transact(() => {
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's world-space points at its CURRENT size: the stored (base)
 * points scaled by width/baseWidth and height/baseHeight, offset by the
 * bbox origin (pen.resize). Thickness is a separate field and is NOT
 * scaled.
 */
export function scaledPoints(
  s: Pick<StrokeSnap, 'x' | 'y' | 'width' | 'height' | 'points' | 'baseWidth' | 'baseHeight'>,
): Point[] {
  const sx = s.baseWidth !== 0 ? (s.width ?? 0) / s.baseWidth : 0;
  const sy = s.baseHeight !== 0 ? (s.height ?? 0) / s.baseHeight : 0;
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    pts.push({ x: s.x + s.points[i]! * sx, y: s.y + s.points[i + 1]! * sy });
  }
  return pts;
}

/** The stroke fields present on the GENERIC snapshot (colour excluded —
 *  the generic snapshot's `color` stays sticky-typed), or null. */
export function strokeFields(
  obj: ObjectSnapshot,
): { points: readonly number[]; baseWidth: number; baseHeight: number; thickness: PenThickness } | null {
  if (obj.type !== 'stroke' || !Array.isArray(obj.points)) return null;
  if (typeof obj.baseWidth !== 'number' || typeof obj.baseHeight !== 'number') return null;
  if (typeof obj.thickness !== 'string' || !(obj.thickness in PEN_THICKNESS_WORLD)) return null;
  return { points: obj.points, baseWidth: obj.baseWidth, baseHeight: obj.baseHeight, thickness: obj.thickness };
}

/**
 * The stroke's distance-based hit test on a GENERIC snapshot (pen.select):
 * true when `p` (world) is within the larger of half the stroke thickness
 * and STROKE_HIT_TOLERANCE_PX / zoom of the scaled line.
 */
export function strokeHitsPoint(obj: ObjectSnapshot, p: Point, zoom: number): boolean {
  const f = strokeFields(obj);
  if (f === null) return false;
  const pts = scaledPoints({ x: obj.x, y: obj.y, width: obj.width, height: obj.height, ...f });
  if (pts.length === 0) return false;
  const t = Math.max(PEN_THICKNESS_WORLD[f.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  return distanceToPolyline(pts, p) <= t;
}

/** The stroke object's extended snapshot, or null for a stale/non-stroke id. */
export function strokeSnapshot(doc: Y.Doc, id: string): StrokeSnap | null {
  ensureType();
  const entry = strokeEntry(doc, id);
  if (entry === undefined) return null;
  const color = entry.get('color');
  const thickness = entry.get('thickness');
  if (typeof color !== 'string' || !(color in PEN_COLORS)) return null;
  if (typeof thickness !== 'string' || !(thickness in PEN_THICKNESS_WORLD)) return null;
  const points = entry.get('points');
  if (!Array.isArray(points)) return null;
  return {
    id,
    type: STROKE_TYPE,
    x: num(entry.get('x')),
    y: num(entry.get('y')),
    width: num(entry.get('width')),
    height: num(entry.get('height')),
    z: num(entry.get('z')),
    createdAt: num(entry.get('createdAt')),
    text: '',
    color: color as PenColor,
    points: points as readonly number[],
    baseWidth: num(entry.get('baseWidth')),
    baseHeight: num(entry.get('baseHeight')),
    thickness: thickness as PenThickness,
  };
}
