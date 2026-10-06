/**
 * The stroke object (schema: `stroke.model`): one line somebody drew with the pen.
 *
 * A stroke stores *the line*, not the movement. What the pointer recorded is hundreds of points
 * a second, most of them repeating what their neighbours already said; what is kept is the
 * simplified path, flattened into one array of numbers, in a box.
 *
 * That box is the interesting decision, and it is here rather than in a resize handler because
 * resizing must not re-record anything (`pen.resize`). The points are relative to the box's
 * origin, and the box's size *at creation* is kept beside them as `baseWidth`/`baseHeight`, so
 * the rendering is one multiplication: a box twice as wide draws the line twice as wide, in both
 * directions, and the stroke's proportions survive a resize nobody thought about. Nothing is
 * re-simplified, so a stroke never drifts further from what the hand drew by being nudged.
 *
 * Two rules the rest of the app depends on:
 *
 *  - one stroke is one transaction, written whole. There is no half-drawn stroke on the wire:
 *    the tool keeps the drawing to itself until the pen leaves the board (see `PenTool`), and
 *    what arrives at a colleague's screen is a finished line;
 *  - a colour or thickness outside the palette is refused rather than stored, so a stroke on any
 *    board can be drawn by this build (`stroke.model.valid`). A rejection opens no transaction,
 *    which means it costs the document nothing and nobody else sees a thing.
 */

import * as Y from 'yjs';
import { createId, declareObjectType, LOCAL_ORIGIN, maxZ, type ObjectSnapshot } from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MIN_SIZE_WORLD,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS
} from '../config';
import type { Point } from '../geometry';

/** The object type name this module owns. */
export const STROKE_OBJECT_TYPE = 'stroke';

/** A pen colour, by palette name. */
export type PenColor = keyof typeof PEN_COLORS;
/** A pen thickness, by palette name. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** A stroke, as the screen and the snapshot worker read it. */
export interface StrokeSnap extends ObjectSnapshot {
  readonly type: 'stroke';
  /** A stroke always carries a box: the smallest one that holds the line and its thickness. */
  readonly width: number;
  readonly height: number;
  /**
   * The line, flattened — `[x0, y0, x1, y1, …]` — relative to the box's own origin, in board
   * units at the size the stroke was created at. Read it with {@link scaledPoints}.
   */
  readonly points: readonly number[];
  /** The box the stroke was created with: what `points` are a fraction of. */
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: PenColor;
  readonly thickness: PenThickness;
  readonly createdAt: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

/** A stroke's thickness in board units. */
export function penThicknessWorld(thickness: PenThickness | unknown): number {
  return isPenThickness(thickness) ? PEN_THICKNESS_WORLD[thickness] : PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
}

/** The stored numbers, or nothing at all: a malformed line is an empty one, never a crash. */
function readPoints(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length % 2 !== 0) return [];
  for (const entry of value) if (!isFiniteNumber(entry)) return [];
  return value as readonly number[];
}

/** A stored size, or the size the line was drawn at, or the smallest box there is. */
function readSize(value: unknown, fallback: number): number {
  const size = isFiniteNumber(value) && (value as number) > 0 ? (value as number) : fallback;
  return size > 0 ? size : STROKE_MIN_SIZE_WORLD;
}

/**
 * The stroke's own reader: see `declareObjectType` in `../board-model.ts`.
 *
 * An unreadable point list comes back empty — a stroke that cannot be drawn is still a stroke
 * that can be selected and deleted — and an unknown colour or thickness falls back to the
 * default rather than dropping a line somebody drew.
 */
function readStrokeObject(object: Y.Map<unknown>, common: ObjectSnapshot): StrokeSnap {
  const createdAt = object.get('createdAt');
  const baseWidth = readSize(object.get('baseWidth'), STROKE_MIN_SIZE_WORLD);
  const baseHeight = readSize(object.get('baseHeight'), STROKE_MIN_SIZE_WORLD);
  return {
    ...common,
    type: STROKE_OBJECT_TYPE,
    width: readSize(object.get('width'), baseWidth),
    height: readSize(object.get('height'), baseHeight),
    points: readPoints(object.get('points')),
    baseWidth,
    baseHeight,
    color: isPenColor(object.get('color')) ? (object.get('color') as PenColor) : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(object.get('thickness'))
      ? (object.get('thickness') as PenThickness)
      : DEFAULT_PEN_THICKNESS,
    createdAt: isFiniteNumber(createdAt) ? (createdAt as number) : 0
  };
}

declareObjectType(STROKE_OBJECT_TYPE, readStrokeObject);

/**
 * The box that holds `points`, padded by half the line's own thickness on every side.
 *
 * The padding is not decoration: the stroke is drawn with the line *centred* on its path, so a
 * line that touches the edge of a tight box has half its thickness cut off. A single point gets
 * a box one thickness across — the dot the pen makes — and a perfectly straight horizontal line
 * still has a box with a height in it, which is what makes it selectable, resizable and
 * frameable by code that knows nothing about strokes.
 */
function strokeBBox(points: readonly Point[], thickness: number): { x: number; y: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const pad = thickness / 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/** Is this a line the model can hold? */
function usablePath(points: unknown): points is readonly Point[] {
  if (!Array.isArray(points) || points.length === 0) return false;
  for (const point of points) {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return false;
  }
  return true;
}

/**
 * Draw a stroke (`pen.draw`) and return its id.
 *
 * `points` are board units, in the order the pen went through them, already simplified by the
 * tool that recorded them. The bounding box of the line becomes the object's box, the points are
 * stored relative to it, and `baseWidth`/`baseHeight` remember that box so a later resize can
 * scale the line by comparison instead of by re-recording it (`pen.resize`).
 *
 * The stroke is on top of everything already on the board, and carries the identity of whoever
 * drew it when there is one — it is the only story that ever knows whose line it was.
 *
 * Returns `null` when the request is not something the model can hold: no points, a coordinate
 * that is not a real number, or a colour or thickness outside the palette. A rejection opens no
 * transaction at all, so a colleague sees nothing, not even an attempt.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string
): string | null {
  if (!a || !usablePath(a.points)) return null;
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  const points = a.points;
  if (points.some((point) => Math.abs(point.x) > 1e9 || Math.abs(point.y) > 1e9)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const box = strokeBBox(points, thickness);
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height) || box.width <= 0 || box.height <= 0) return null;

  // Flattened, relative to the box: half the Yjs values, and a resize is a multiplication.
  const stored: number[] = [];
  for (const point of points) stored.push(point.x - box.x, point.y - box.y);

  let created: string | null = null;
  doc.transact(() => {
    const id = createId();
    const object = new Y.Map<unknown>();
    object.set('id', id);
    object.set('type', STROKE_OBJECT_TYPE);
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('points', stored);
    object.set('baseWidth', box.width);
    object.set('baseHeight', box.height);
    // Created on top: a line you drew and cannot see is a line you will draw again.
    object.set('z', maxZ(doc) + 1);
    object.set('color', a.color);
    object.set('thickness', a.thickness);
    object.set('createdAt', Date.now());
    if (typeof by === 'string' && by !== '') object.set('createdBy', by);
    doc.getMap<Y.Map<unknown>>('objects').set(id, object);
    created = id;
  }, LOCAL_ORIGIN);
  return created;
}

/**
 * The line in world coordinates, scaled by how big the box is now.
 *
 * This is the one place the `points`/`baseWidth` decision is paid out: `width / baseWidth` is how
 * much the drawing has been stretched, and applying it to every point is the whole of
 * `pen.resize`. A stroke nobody has touched scales by exactly one, so this is also how a stroke
 * is drawn when nothing has happened to it.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  if (!s || !Array.isArray(s.points) || s.points.length < 2) return [];
  const baseWidth = isFiniteNumber(s.baseWidth) && s.baseWidth > 0 ? s.baseWidth : 0;
  const baseHeight = isFiniteNumber(s.baseHeight) && s.baseHeight > 0 ? s.baseHeight : 0;
  const scaleX = baseWidth > 0 && isFiniteNumber(s.width) ? s.width / baseWidth : 1;
  const scaleY = baseHeight > 0 && isFiniteNumber(s.height) ? s.height / baseHeight : 1;
  const originX = isFiniteNumber(s.x) ? s.x : 0;
  const originY = isFiniteNumber(s.y) ? s.y : 0;

  const points: Point[] = [];
  for (let index = 0; index + 1 < s.points.length; index += 2) {
    points.push({ x: originX + (s.points[index] as number) * scaleX, y: originY + (s.points[index + 1] as number) * scaleY });
  }
  return points;
}

