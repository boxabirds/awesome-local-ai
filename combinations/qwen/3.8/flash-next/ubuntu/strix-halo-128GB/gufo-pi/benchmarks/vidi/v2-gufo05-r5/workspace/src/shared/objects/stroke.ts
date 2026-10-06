/**
 * The stroke object: a finished freehand line (story 11).
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *   points: number[],           // flattened [x0, y0, x1, y1, ...], relative to the box origin,
 *                               // recorded against `baseWidth` x `baseHeight`
 *   baseWidth, baseHeight,      // the box the points were recorded against
 *   color: PenColor, thickness: PenThickness
 * }
 * ```
 *
 * A stroke is written once and its points are never edited afterwards: moving and resizing are the
 * generic story 7 writes to `x`, `y`, `width` and `height`, and `scaledPoints` turns the stored points
 * into the line as it hangs on the board now. That is why the points can be a plain array inside the
 * object's `Y.Map` - it is replaced atomically or not at all - and why resizing a drawing scales the
 * drawing in proportion while the ink stays the thickness it was drawn with.
 *
 * The box is padded outwards by half the thickness, so the round cap of the line is inside its own
 * bounds and the selection outline sits around the ink instead of cutting through it.
 *
 * Every accepted change is one `LOCAL_ORIGIN` transaction, and every rejection happens before a
 * transaction is opened - so a stroke nobody can draw produces no update for anybody else to receive.
 */
import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../config';
import { distanceToPolyline } from '../geometry/polyline';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN } from '../y-origin';

/** The document map holding every object, by id. Named in one place, like the other model modules. */
const OBJECTS = 'objects';

/** The ceiling on `z`, so a very long-lived board cannot run out of room above the top. */
const MAX_Z = Number.MAX_SAFE_INTEGER - 1;

/** One of the six pen colours, by the name the document stores. */
export type PenColor = keyof typeof PEN_COLORS;

/** One of the three pen thicknesses, by the name the document stores. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** The CSS colour of a pen colour name; anything unrecognised draws as the default. */
export function penColorValue(color: string): string {
  return PEN_COLORS[color as PenColor] ?? PEN_COLORS.black;
}

/** How thick a name draws, in world units; anything unrecognised draws as the default. */
export function penThicknessWorld(thickness: string): number {
  return PEN_THICKNESS_WORLD[thickness as PenThickness] ?? PEN_THICKNESS_WORLD.medium;
}

/**
 * One stroke, as rendered by React.
 *
 * Spelled out rather than `extends ObjectSnapshot`, because `ObjectSnapshot` is the union of every
 * object type and an interface cannot extend a union (story 9 learned this first).
 */
export interface StrokeSnapshot {
  readonly id: string;
  readonly type: 'stroke';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly createdAt: number;
  readonly createdBy: string;
  /** Flattened `[x0, y0, x1, y1, ...]`, relative to the box origin, at creation size. */
  readonly points: readonly number[];
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: PenColor;
  readonly thickness: PenThickness;
}

/** The short name the design uses for the same snapshot. */
export type StrokeSnap = StrokeSnapshot;

function num(raw: Y.Map<unknown>, key: string): number | undefined {
  const value = raw.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(raw: Y.Map<unknown>, key: string): string | undefined {
  const value = raw.get(key);
  return typeof value === 'string' ? value : undefined;
}

function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

/** The points a stroke can be made of: at least one, and every coordinate a real number. */
function usablePoints(points: readonly Point[]): Point[] | null {
  if (points.length === 0) return null;
  const clean: Point[] = [];
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    clean.push({ x: point.x, y: point.y });
  }
  return clean;
}

/** Creates one finished stroke and returns its id, or `null` when the request is refused. */
export function createStroke(
  doc: Y.Doc,
  args: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const points = usablePoints(args.points);
  if (!points) return null;
  if (!isPenColor(args.color) || !isPenThickness(args.thickness)) return null;

  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS);
  let top = 0;
  for (const value of objects.values()) {
    const z = value.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  // The id is minted now, so a stroke is never written by a client that had already run out of ids.
  const id = `o_${Math.random().toString(36).slice(2, 10)}`;
  if (objects.has(id)) return null;

  const half = penThicknessWorld(args.thickness) / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  // Padded outwards by half the thickness: the box is the ink and its cap, not the centreline.
  const x = minX - half;
  const y = minY - half;
  const width = maxX - minX + half * 2;
  const height = maxY - minY + half * 2;

  // Points from the box origin, flattened: one array, replaced whole, never edited point by point.
  const relative: number[] = [];
  for (const point of points) {
    relative.push(point.x - x, point.y - y);
  }

  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    ymap.set('type', 'stroke');
    ymap.set('x', x);
    ymap.set('y', y);
    ymap.set('width', width);
    ymap.set('height', height);
    ymap.set('z', Math.min(top + 1, MAX_Z));
    ymap.set('createdAt', Date.now());
    if (by) ymap.set('createdBy', by);
    ymap.set('points', relative);
    ymap.set('baseWidth', width);
    ymap.set('baseHeight', height);
    ymap.set('color', args.color);
    ymap.set('thickness', args.thickness);
    objects.set(id, ymap);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's stored points as they are drawn at its current size: the box has been moved, and it may
 * have been resized, but the only thing that ever changed is `x`, `y`, `width` and `height`.
 */
export function scaledPoints(stroke: StrokeSnap): Point[] {
  const sx = stroke.baseWidth > 0 ? stroke.width / stroke.baseWidth : 1;
  const sy = stroke.baseHeight > 0 ? stroke.height / stroke.baseHeight : 1;
  const points: Point[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    points.push({
      x: stroke.x + (stroke.points[i] ?? 0) * sx,
      y: stroke.y + (stroke.points[i + 1] ?? 0) * sy,
    });
  }
  return points;
}

/**
 * True when a world point selects this stroke.
 *
 * A click is as forgiving as the ink is visible: at least half the thickness of the line - so a click
 * on the paint is always a hit - and otherwise `tolerancePx` screen pixels, which is world units once
 * divided by the zoom. The tolerance is a maximum of the two and not a sum, so a thick stroke drawn
 * close up does not become selectable a mile away from its line.
 */
export function hitStroke(
  stroke: StrokeSnap,
  point: Point,
  zoom: number,
  tolerancePx: number = STROKE_HIT_TOLERANCE_PX,
): boolean {
  const points = scaledPoints(stroke);
  if (points.length === 0) return false;
  const safeZoom = zoom > 0 ? zoom : 1;
  const tolerance = Math.max(penThicknessWorld(stroke.thickness) / 2, tolerancePx / safeZoom);
  return distanceToPolyline(points, point) <= tolerance;
}

/** Reads one `Y.Map` into a `StrokeSnapshot`, or `undefined` when it cannot be drawn. */
export function readStrokeObject(id: string, raw: Y.Map<unknown>): StrokeSnapshot | undefined {
  if (raw.get('type') !== 'stroke') return undefined;
  const x = num(raw, 'x');
  const y = num(raw, 'y');
  const width = num(raw, 'width');
  const height = num(raw, 'height');
  const baseWidth = num(raw, 'baseWidth');
  const baseHeight = num(raw, 'baseHeight');
  const color = str(raw, 'color');
  const thickness = str(raw, 'thickness');
  const rawPoints = raw.get('points');

  // A stroke without its points, its base or its style cannot be drawn as anything sensible, and
  // guessing would put ink on the board that nobody drew.
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (!baseWidth || !baseHeight || baseWidth <= 0 || baseHeight <= 0) return undefined;
  if (!isPenColor(color) || !isPenThickness(thickness)) return undefined;
  if (!Array.isArray(rawPoints) || rawPoints.length < 2 || rawPoints.length % 2 !== 0) return undefined;
  const points: number[] = [];
  for (const value of rawPoints) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    points.push(value);
  }

  const z = num(raw, 'z');
  const createdAt = num(raw, 'createdAt');
  const createdBy = str(raw, 'createdBy');
  return {
    id,
    type: 'stroke',
    x,
    y,
    width,
    height,
    z: z ?? 0,
    createdAt: createdAt ?? 0,
    createdBy: createdBy ?? '',
    points,
    baseWidth,
    baseHeight,
    color,
    thickness,
  };
}
