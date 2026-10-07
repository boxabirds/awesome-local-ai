/**
 * A drawn line on the board (`src/shared/objects/stroke.ts`, story 11).
 *
 * A stroke is the first object on this board whose *shape* is stored rather than
 * described. A sticky note is a rectangle with words in it and a shape is a kind plus a
 * box, so both can be redrawn from four numbers; a stroke is a line somebody's hand
 * made, and the only honest record of it is the line. So the object holds the trail
 * (`points`) alongside the box, and everything else about a stroke - how big it is,
 * where it is, what it takes to click on it - is derived from that trail.
 *
 * Four decisions in here are the whole of the type, and each is a consequence of the
 * one thing above them:
 *
 * - **the box is the trail plus the ink.** `x`/`y`/`width`/`height` are the trail's
 *   extremes grown by half the pen on every side, because the ink lies that far outside
 *   the centre of the line. With the padding in the stored box, `objectBounds` needs no
 *   special case, and moving a stroke is an ordinary `moveObject`: the marquee, the
 *   selection outline, the stacking, the delete and the undo that story 7 already does
 *   to a rectangle are all already right. A one-point dot comes to an 8-unit square at a
 *   thick pen, which is the difference between a dot with a box and a dot that cannot be
 *   selected at all.
 * - **the trail is relative, and the scale is remembered.** Points are stored from the
 *   box's own top-left, at the size the stroke was created at, and `baseWidth`/
 *   `baseHeight` remember that size. What a stroke looks like now is those points scaled
 *   by `width / baseWidth` ({@link scaledPoints}) - so a resize is two numbers rather
 *   than a rewrite of five thousand, it is exactly reproducible on every screen, and
 *   "resize a drawing in proportion" is a property of the data rather than a rule the
 *   drag has to remember.
 * - **the ink is not a dimension.** `thickness` is the pen that was chosen and it never
 *   scales with the box: stretch a stroke to twice the size and the line gets twice as
 *   long and exactly as thick. That is what a person means by resizing a drawing.
 * - **one stroke, one transaction, or none.** {@link createStroke} writes the whole
 *   thing in a single `LOCAL_ORIGIN` transaction and refuses anything it could not draw
 *   - an empty trail, a point that is not a number, an ink the palette has not, a pen
 *   that does not exist - by returning `null` and writing *nothing*, so a rejected stroke
 *   leaves no map, no `update` event, no sync message and no undo step.
 *
 * The points are a flat array of numbers (`[x0, y0, x1, y1, ...]`) rather than an array
 * of objects, because five thousand small objects in a Y.Map would be five thousand
 * items for a peer to reconcile when the truth is one atomic value that is written once
 * and never edited point by point ({@link strokePoints} turns it back into points).
 *
 * Framework-free, like every other file in `src/shared`: the room and the Worker import
 * `board-model`, and a stroke they cannot draw they must still be able to move.
 */

import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  OBJECT_FIELDS,
  objectSnapshot,
  type ObjectSnapshot,
  type Point,
  type Rect,
} from '../board-model.js';
// The type's own registrations go through the registry module directly rather than
// through the re-exports in `board-model`: board-model imports `connector.ts`, so a
// re-export of these functions would not be filled in until board-model had finished
// loading, and which of the two a caller got would depend on which file was loaded
// first. (The note in `shape.ts` has the full story.)
import {
  registerBoardObjectType,
  registerDefaultObjectSize,
  registerObjectSnapshotReader,
} from '../object-registry.js';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  isPenColor,
  isPenThickness,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  type PenColor,
  type PenThickness,
} from '../config.js';
import { distanceToPolyline } from '../geometry/polyline.js';

/** The object type name, as stored in `objects.<id>.type`. */
export const STROKE_TYPE = 'stroke';

/** Which of the six inks and which of the three pens made this stroke. */
export type { PenColor, PenThickness };

/**
 * An immutable view of one stroke, as the board renders it.
 *
 * `points` is the trail as stored: flat numbers, measured from (`x`, `y`), at
 * `baseWidth` x `baseHeight`. It is the ink's *centre* - the line sticks out
 * `strokeThickness() / 2` on either side of it - which is why the box is bigger than the
 * trail by exactly that much on all four sides.
 */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** The ink, by palette name (`PEN_COLORS`). */
  color: PenColor;
  /** The pen, by name (`PEN_THICKNESS_WORLD`). */
  thickness: PenThickness;
  /** The trail, flat: `[x0, y0, x1, y1, ...]`, relative to this object's own `x`/`y`. */
  points: number[];
  /** The box those points were drawn into; the size {@link scaledPoints} scales from. */
  baseWidth: number;
  /** As `baseWidth`, vertically. */
  baseHeight: number;
  /** Who made it; absent when the creating tab had no name to give (this build). */
  createdBy?: string;
}

/** What a caller asks the model for: a trail, and the pen that drew it. */
export interface CreateStrokeInput {
  /** The trail, in world units, as points. One point is a dot; none is not a stroke. */
  points: readonly Point[];
  /** The ink. Defaults to {@link DEFAULT_PEN_COLOR}. */
  color?: PenColor;
  /** The pen. Defaults to {@link DEFAULT_PEN_THICKNESS}. */
  thickness?: PenThickness;
}

/**
 * The type is known to the document model as soon as this module loads, so a move, a
 * resize, a marquee and a delete answer for a stroke exactly as they do for a note. The
 * default size is the smallest box a stroke may be resized to: a stroke always arrives
 * with its own box, and this is only what it means if it somehow lost it.
 */
registerBoardObjectType(STROKE_TYPE);
registerObjectSnapshotReader(STROKE_TYPE, readStrokeSnapshot);
registerDefaultObjectSize(STROKE_TYPE, STROKE_MIN_SIZE_WORLD);

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;

/** The fields a stroke keeps that no other object on the board keeps. */
const POINTS_FIELD = 'points';
const THICKNESS_FIELD = 'thickness';
const BASE_WIDTH_FIELD = 'baseWidth';
const BASE_HEIGHT_FIELD = 'baseHeight';
const CREATOR_FIELD = 'createdBy';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A stored point: a pair of finite numbers, in whatever shape it arrived in. */
const isPointLike = (value: unknown): value is Point => {
  if (value === null || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
};

/** The largest `z` in the document (0 when there is nothing to be on top of). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let z = 0;
  objects.forEach((map) => {
    const value = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(value) && value > z) z = value;
  });
  return z;
}

/** A unique object id; `crypto.randomUUID` is there in the browser and in the Worker. */
function nextId(): string {
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoObject?.randomUUID !== undefined) return cryptoObject.randomUUID();
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Flat numbers to points. An odd number is a trail with a point lost on the way: the
 * dangling number is not a point, and is left out rather than drawn as half a line. */
export function strokePoints(points: readonly number[]): Point[] {
  if (!Array.isArray(points)) return [];
  const result: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index] as number;
    const y = points[index + 1] as number;
    if (isFiniteNumber(x) && isFiniteNumber(y)) result.push({ x, y });
  }
  return result;
}

/** Points to flat numbers, which is how the trail is stored. */
function flattenPoints(points: readonly Point[]): number[] {
  const flat: number[] = [];
  for (const point of points) {
    flat.push(point.x, point.y);
  }
  return flat;
}

/** Read the stored trail out of a snapshot's field, whatever shape the document has it in. */
function readTrail(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const trail: number[] = [];
  for (const entry of value) {
    // A document written by an older client could hold objects; a trail is a trail.
    if (isPointLike(entry)) {
      trail.push(entry.x, entry.y);
    } else if (isFiniteNumber(entry)) {
      trail.push(entry);
    }
  }
  return trail.length % 2 === 0 ? trail : trail.slice(0, -1);
}

/** Read one object map into a stroke snapshot, or `undefined` when it is not one. */
function readStrokeSnapshot(id: string, map: Y.Map<unknown>): StrokeSnap | undefined {
  const x = map.get(OBJECT_FIELDS.x);
  const y = map.get(OBJECT_FIELDS.y);
  const z = map.get(OBJECT_FIELDS.z);
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  const color = map.get(OBJECT_FIELDS.color);
  const thickness = map.get(THICKNESS_FIELD);
  if (!isPenColor(color) || !isPenThickness(thickness)) return undefined;
  const points = readTrail(map.get(POINTS_FIELD));
  // A stroke with no trail is a drawing of nothing; it is not a snapshot, and it is
  // certainly not something a click should be able to select.
  if (points.length === 0) return undefined;
  const baseWidth = map.get(BASE_WIDTH_FIELD);
  const baseHeight = map.get(BASE_HEIGHT_FIELD);
  const createdAt = map.get(OBJECT_FIELDS.createdAt);

  const snapshot: StrokeSnap = {
    id,
    type: STROKE_TYPE,
    x,
    y,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    color,
    thickness,
    points,
    baseWidth: isFiniteNumber(baseWidth) ? baseWidth : 0,
    baseHeight: isFiniteNumber(baseHeight) ? baseHeight : 0,
  };
  const width = map.get(OBJECT_FIELDS.width);
  const height = map.get(OBJECT_FIELDS.height);
  if (isFiniteNumber(width)) snapshot.width = width;
  if (isFiniteNumber(height)) snapshot.height = height;
  const creator = map.get(CREATOR_FIELD);
  if (typeof creator === 'string' && creator.length > 0) snapshot.createdBy = creator;
  return snapshot;
}

/** How thick a pen of this name is, in board units; the default pen for a name that lost its name. */
function strokeWidthOf(thickness: PenThickness): number {
  return PEN_THICKNESS_WORLD[thickness] ?? PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
}

/** How thick the ink of a stroke is, in board units. */
export function strokeThickness(stroke: StrokeSnap): number {
  return strokeWidthOf(stroke.thickness);
}

/**
 * The extremes of a trail, in world units: the points and nothing else. A single point
 * has no extremes to speak of, and the answer is a box of nothing at that point - the
 * padding is what makes a dot a dot, and it is applied by the caller that stores the
 * box, so the arithmetic happens in one place.
 */
function strokePointsBBox(points: readonly Point[]): Rect {
  if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The box the ink occupies, which is the object's own `x`/`y`/`width`/`height`: the ink's
 * half-pen was folded into it at creation, which is the whole point of folding it in
 * there - `objectBounds`, the marquee, the selection outline and the resize handles all
 * read an ordinary rectangle and are already right. A box that is missing or is not a
 * positive size falls back to the size the stroke came with, so a stroke is drawn where
 * it was drawn rather than at the origin or at nothing.
 */
function storedBox(stroke: StrokeSnap): Rect {
  const width = storedSize(stroke.width, stroke.baseWidth);
  const height = storedSize(stroke.height, stroke.baseHeight);
  return { x: stroke.x, y: stroke.y, width, height };
}

/** A size that is not a number, or is not a positive one, means "the size it came with". */
function storedSize(size: number | undefined, base: number): number {
  return isFiniteNumber(size) && size > 0 ? size : Math.max(base, 0);
}

/**
 * The trail as it is drawn now: the stored points scaled from the size they were drawn
 * at to the size the object is now ({@link StrokeSnap}, "the scale is remembered").
 *
 * This is the whole of `pen.resize`, and the reason resizing a drawing costs two numbers
 * instead of rewriting five thousand. The scale is per axis - a stroke stretches as well
 * as grows - and it is the *selection layer* that keeps the two scales equal for a stroke
 * (`aspectLocked` in the client registry); should it ever stop doing that, the stroke
 * comes out distorted rather than broken, which is the better failure: a distorted
 * drawing is still the same drawing on every screen. Where the base is 0 there is nothing
 * to scale from and the points are drawn where they were put - a straight line stored with
 * no height has no vertical scale to apply, and 0/0 is not a number.
 *
 * The ink is deliberately not here: the pen is not a dimension.
 */
export function scaledPoints(stroke: StrokeSnap): Point[] {
  const points = strokePoints(stroke.points);
  const baseWidth = Math.max(stroke.baseWidth, 0);
  const baseHeight = Math.max(stroke.baseHeight, 0);
  const box = storedBox(stroke);
  const scaleX = baseWidth > 0 ? box.width / baseWidth : 1;
  const scaleY = baseHeight > 0 ? box.height / baseHeight : 1;
  if (scaleX === 1 && scaleY === 1) return points;
  return points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
}

/**
 * Whether a point in world units is a click on this stroke (`pen.select`).
 *
 * `STROKE_HIT_TOLERANCE_PX` *screen* pixels, converted to board units by the zoom, and
 * never less than half the ink. The zoom is why the function takes it at all: a target
 * measured in board units is a target that is impossible to hit at 20% and enormous at
 * 400%, and the promise a person can check is that the line is as easy to click whatever
 * the view is. The ink half is there so a click that lands on a thick line is a click on
 * it even when six screen pixels is three board units.
 *
 * Everything outside that band - the whole inside of a loop, for instance - is not this
 * stroke, and belongs to whatever the stroke was drawn on top of.
 */
export function strokeIsAt(stroke: StrokeSnap, point: Point, zoom = 1): boolean {
  if (!isPointLike(point)) return false;
  const points = scaledPoints(stroke);
  if (points.length === 0) return false;
  const tolerance = Math.max(
    strokeThickness(stroke) / 2,
    STROKE_HIT_TOLERANCE_PX / (isFiniteNumber(zoom) && zoom > 0 ? zoom : 1),
  );
  // One point is a special case because a distance to a line needs a line:
  // `distanceToPolyline` has nothing to measure against and answers `Infinity`, which
  // would leave every dot on the board unclickable. A dot is given the round target it
  // visibly is.
  if (points.length === 1) {
    return Math.hypot(points[0].x - (point.x - stroke.x), points[0].y - (point.y - stroke.y)) <= tolerance;
  }
  const target = { x: point.x - stroke.x, y: point.y - stroke.y };
  return distanceToPolyline(points, target) <= tolerance;
}

/**
 * Draw a stroke on the board (`pen.draw`): the trail, the ink, the pen, on top of
 * everything else, in one transaction.
 *
 * The box is the trail's extremes plus half the pen, and the trail is stored relative to
 * that box, so a stroke is position independent: moving it never touches five thousand
 * numbers, and a stroke drawn at the edge of a zoomed-out board holds the same
 * coordinates it would have held at 100%. A single point is a dot, and comes out as the
 * square the pen draws with the point in its middle - a box of nothing would be a stroke
 * that cannot be clicked, cannot be resized and cannot be seen to be selected.
 *
 * Returns the new id, or `null` for a trail that is empty or contains a point that is
 * not a pair of finite numbers, an ink that is not one of the six, or a pen that is not
 * one of the three. A `null` writes nothing at all - no object, no transaction, so no
 * sync message and no colleague's screen with something to redraw, and no step in this
 * tab's undo history for a stroke that never happened.
 */
export function createStroke(doc: Y.Doc, input: CreateStrokeInput, by = ''): string | null {
  const points = Array.isArray(input?.points) ? input.points : [];
  if (points.length === 0) return null;
  // A trail is rejected as a whole. Dropping the one bad point and drawing the rest
  // would be a stroke the person did not draw, arriving on five screens as though it had.
  for (const point of points) if (!isPointLike(point)) return null;
  const color = input.color ?? DEFAULT_PEN_COLOR;
  const thickness = input.thickness ?? DEFAULT_PEN_THICKNESS;
  if (!isPenColor(color) || !isPenThickness(thickness)) return null;

  const trail = points.map((point) => ({ x: point.x, y: point.y }));
  const extremes = strokePointsBBox(trail);
  const pad = strokeWidthOf(thickness) / 2;
  const box = {
    x: extremes.x - pad,
    y: extremes.y - pad,
    width: extremes.width + pad * 2,
    height: extremes.height + pad * 2,
  };
  const relative = flattenPoints(trail.map((point) => ({ x: point.x - box.x, y: point.y - box.y })));

  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const id = nextId();
  const creator = typeof by === 'string' && by.trim().length > 0 ? by : null;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, STROKE_TYPE);
    map.set(OBJECT_FIELDS.x, box.x);
    map.set(OBJECT_FIELDS.y, box.y);
    map.set(OBJECT_FIELDS.width, box.width);
    map.set(OBJECT_FIELDS.height, box.height);
    map.set(OBJECT_FIELDS.z, z);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    map.set(OBJECT_FIELDS.color, color);
    map.set(THICKNESS_FIELD, thickness);
    map.set(POINTS_FIELD, relative);
    map.set(BASE_WIDTH_FIELD, box.width);
    map.set(BASE_HEIGHT_FIELD, box.height);
    if (creator !== null) map.set(CREATOR_FIELD, creator);
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Every stroke on the board, in drawing order (`pen.long_stroke` counts these). Read
 * through the same `objectSnapshot` the client renders from, so what a test counts here
 * is what a screen shows.
 */
export function strokeSnapshots(doc: Y.Doc): StrokeSnap[] {
  return objectSnapshot(doc).filter(
    (object): object is StrokeSnap => object.type === STROKE_TYPE,
  );
}
