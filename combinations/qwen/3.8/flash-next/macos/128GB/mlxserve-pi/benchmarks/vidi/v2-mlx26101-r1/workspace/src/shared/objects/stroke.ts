// The stroke object: the freehand mark the pen tool leaves on the board (story 11).
//
// The whole design of this type comes out of one sentence in the PRD: resizing a stroke
// *redraws* it. Every object in this codebase is a box, and a scribble's box is almost empty —
// so if the object stored a path in board coordinates and the renderer drew that path inside a
// box that had been dragged twice as big, resizing would enlarge the frame and leave the drawing
// in the corner it started in. Instead the object stores two things that go together:
//
//   points      — the path, relative to the top-left of the box it was drawn in
//   baseWidth / — the size of that box at the moment the pen lifted
//   baseHeight
//
// which makes a resize a division. `scaledPoints` is the only place the two are combined, so
// the renderer, the hit test and the marquee cannot drift apart about where the line is, and a
// stroke that has been resized twice is still the same path at the same scale rather than a
// path that has been multiplied by itself.
//
// The box is padded outward by half a line thickness on every side, because a round line cap
// sticks half a thickness past the point it is on. Without the padding a stroke's box would be
// a hair smaller than the mark inside it, and a single dot — one point, which never moved —
// would have a box of zero width, which is no box at all (pen.dot).
//
// Like every object in this project: `null` from `createStroke` before a transaction is opened,
// an unknown-type-free snapshot from `strokeFromMap`, and one document `update` per stroke.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MIN_SIZE_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** The path, flattened `[x0, y0, x1, y1, …]`, in the box's own coordinates. */
  points: readonly number[];
  /** The box's size when the pen lifted: the denominator of every resize since. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  width: number;
  height: number;
  /** The author who drew it (audit only). */
  createdBy: string;
  createdAt: number;
}

export interface StrokeCreation {
  /** The path, in board coordinates, as the pointer recorded it (already smoothed). */
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `o_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function maxZ(map: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  map.forEach((v) => {
    const z = typeof v.get('z') === 'number' ? (v.get('z') as number) : 0;
    if (z > max) max = z;
  });
  return max;
}

/** @internal Exported for tests. A stroke's raw map, or undefined. */
export function getStrokeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objects(doc).get(id);
  return m && m.get('type') === 'stroke' ? m : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function penColor(value: unknown): PenColor {
  return typeof value === 'string' && value in PEN_COLORS
    ? (value as PenColor)
    : DEFAULT_PEN_COLOR;
}

function penThickness(value: unknown): PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD
    ? (value as PenThickness)
    : DEFAULT_PEN_THICKNESS;
}

/** The point the path is stored against, and the box it will be drawn in. */
function boxOf(
  points: readonly Point[],
  thicknessPx: number,
): { x: number; y: number; width: number; height: number } {
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
  // The padding is a round line cap's room: it sticks half a thickness past the point it is on,
  // so the mark is the path plus one thickness and the box is never smaller than the mark.
  const width = maxX - minX + thicknessPx;
  const height = maxY - minY + thicknessPx;
  // A box is never the size of nothing, and when it has to be grown to that minimum it is grown
  // equally on both sides, so the mark stays in the middle of the box rather than at one edge.
  const grownX = Math.max(width, STROKE_MIN_SIZE_WORLD);
  const grownY = Math.max(height, STROKE_MIN_SIZE_WORLD);
  return {
    x: minX - thicknessPx / 2 - (grownX - width) / 2,
    y: minY - thicknessPx / 2 - (grownY - height) / 2,
    width: grownX,
    height: grownY,
  };
}

/**
 * A freehand mark, drawn at `points` in board units, in the colour and thickness the pen was
 * set to, on top of everything else.
 *
 * Nothing about a stroke is guessed at: the box is the path's own bounding box padded by half a
 * line width, and the points are stored relative to it, so the mark and its box agree from the
 * first frame and after the hundredth resize. Returns the id, or `null` without opening a
 * transaction for a path with no points in it, a path with a non-finite number in it, a colour
 * or thickness the board does not have, or a board with nobody to author it (errors).
 */
export function createStroke(
  doc: Y.Doc,
  a: StrokeCreation,
  by: string,
): string | null {
  if (typeof by !== 'string' || by.length === 0) return null;
  if (!Array.isArray(a?.points) || a.points.length === 0) return null;
  for (const p of a.points) {
    if (!p || !finite(p.x) || !finite(p.y)) return null;
  }
  const color = a.color in PEN_COLORS ? a.color : null;
  const thickness = a.thickness in PEN_THICKNESS_WORLD ? a.thickness : null;
  if (color === null || thickness === null) return null;

  const box = boxOf(a.points, PEN_THICKNESS_WORLD[thickness]);
  const points: number[] = [];
  for (const p of a.points) {
    points.push(p.x - box.x, p.y - box.y);
  }

  const id = newId();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'stroke');
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    // The size the pen left behind, kept beside the path it belongs to: every resize since is
    // measured against this, never against the box as it happens to be now.
    map.set('baseWidth', box.width);
    map.set('baseHeight', box.height);
    map.set('points', points);
    map.set('color', color);
    map.set('thickness', thickness);
    map.set('z', maxZ(objects(doc)) + 1);
    map.set('createdBy', by);
    map.set('createdAt', Date.now());
    objects(doc).set(id, map as unknown as Y.Map<unknown>);
  }, LOCAL_ORIGIN);
  return id;
}

/** @internal `type === 'stroke'` map → snapshot; undefined for a map that cannot be one. */
export function strokeFromMap(id: string, m: Y.Map<unknown>): StrokeSnap | undefined {
  const pointsValue = m.get('points');
  if (!Array.isArray(pointsValue) || pointsValue.length === 0) return undefined;
  const points: number[] = [];
  for (const value of pointsValue) {
    // A path with a hole in it is not a path: half a stroke is not worth drawing, and the
    // board's rule is that a map that cannot be its type is not on the board at all.
    if (!finite(value)) return undefined;
    points.push(value);
  }
  if (points.length % 2 !== 0) return undefined;

  const width = finite(m.get('width')) ? (m.get('width') as number) : 0;
  const height = finite(m.get('height')) ? (m.get('height') as number) : 0;
  // A map whose base size is missing or impossible is a map that was never drawn: scaling
  // against it would be a division by zero, which is not a way to guess a size.
  const baseWidth = finite(m.get('baseWidth')) ? (m.get('baseWidth') as number) : 0;
  const baseHeight = finite(m.get('baseHeight')) ? (m.get('baseHeight') as number) : 0;
  if (width <= 0 || height <= 0 || baseWidth <= 0 || baseHeight <= 0) return undefined;

  return {
    id,
    type: 'stroke',
    x: finite(m.get('x')) ? (m.get('x') as number) : 0,
    y: finite(m.get('y')) ? (m.get('y') as number) : 0,
    z: finite(m.get('z')) ? (m.get('z') as number) : 0,
    width,
    height,
    points,
    baseWidth,
    baseHeight,
    color: penColor(m.get('color')),
    thickness: penThickness(m.get('thickness')),
    createdBy: typeof m.get('createdBy') === 'string' ? (m.get('createdBy') as string) : '',
    createdAt: finite(m.get('createdAt')) ? (m.get('createdAt') as number) : 0,
  };
}

/** Anything with a path, a box and the size the box was drawn at. */
export interface StrokeGeometry {
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  width: number;
  height: number;
}

/**
 * The path as it is drawn now: each stored point scaled by how much bigger the box is than the
 * box the pen made, and left in the box's own coordinates (the top-left of the box is 0, 0).
 *
 * A stroke that has never been resized comes back with the coordinates it was stored with —
 * the ratio is 1 by definition — so a test of a fresh stroke and a test of a resized one are
 * reading the same function. This is the function the renderer builds its path from and the one
 * the hit test measures against, which is the sense in which what a person clicks is what a
 * person sees (pen.resize, pen.select).
 */
export function scaledPoints(s: StrokeGeometry): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: (s.points[i] as number) * sx, y: (s.points[i + 1] as number) * sy });
  }
  return out;
}

/**
 * The path where the board draws it: the scaled path, moved to the box. The hit test and the
 * marquee work in board coordinates, so this is the form they need; the renderer works in the
 * box's own and needs `scaledPoints`.
 */
export function strokePolyline(s: StrokeGeometry & { x: number; y: number }): Point[] {
  return scaledPoints(s).map((p) => ({ x: p.x + s.x, y: p.y + s.y }));
}

/** How thick this stroke's line is, in board units. */
export function strokeThickness(s: Pick<StrokeSnap, 'thickness'>): number {
  return PEN_THICKNESS_WORLD[s.thickness];
}
