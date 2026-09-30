// The stroke object type (`stroke.model`): the one new kind of thing story 11 adds.
//
// A stroke is a drawing. The document holds the path that was drawn, in coordinates
// relative to the drawing's own box, and every screen paints that as one SVG path. Three
// decisions in here are the ones that matter, and each is a sentence in the PRD:
//
//   * **The points are relative to the box.** Moving a stroke writes `x` and `y` and touches
//     no point at all: a hundred-point line costs two numbers to move, the same as a sticky
//     note, and a stroke dragged across the board writes nothing that has to be merged
//     point by point.
//   * **The box carries the size.** Scaling a stroke re-scales the stored points against
//     `baseWidth`/`baseHeight` when they are drawn, so a resize writes four numbers and the
//     drawing grows in proportion (`pen.resize`) — while `thickness` stays the word the
//     stroke was made with, so a line drawn thin and stretched to twice the size is still
//     a thin line.
//   * **A dot is a stroke.** One point is a legal drawing and gets a box of its own
//     thickness, so a pen that goes down and comes up without travelling leaves a mark
//     (`pen.draw_dot`) that can be selected, moved and deleted like anything else.
//
// The points are one plain array — `[x0, y0, x1, y1, ...]` — rather than an array of points:
// it is one `set()` of one key, the smallest encoding that is still legible to somebody who
// has never read this story, and a stroke is replaced whole rather than having a point
// pushed onto it. Strokes are immutable once made: nothing here writes a point, because a
// finished drawing is a finished drawing (`pen.options` — even changing the colour only
// changes the *next* stroke).
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (stroke.model)
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  registerObjectTypeModel,
  registerObjectTypeReader,
  type BoardObject,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point, Rect } from '../geometry';
import { distanceToPolyline } from '../geometry/polyline';

/** What a stroke holds beyond the fields every object carries. */
export interface StrokeSnapshot extends ObjectSnapshot {
  type: 'stroke';
  /** `[x0, y0, x1, y1, ...]`, in board units, relative to the object's `x`/`y`. */
  points: readonly number[];
  /** How wide the drawing was when it was made: what a resize scales against. */
  baseWidth: number;
  /** How tall the drawing was when it was made. */
  baseHeight: number;
  /** One of the six names in `PEN_COLORS`, never a colour literal. */
  color: PenColor;
  /** One of the three names in `PEN_THICKNESS_WORLD`. */
  thickness: PenThickness;
  createdBy?: string;
  createdAt?: number;
}

/** What the tool has when the pen comes up: a path, and what to draw it with. */
export interface StrokeRequest {
  /** The path, in world coordinates. Whatever smoothing happened has happened. */
  points: readonly Point[];
  color: string;
  thickness: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const isStroke = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'stroke';

const isColor = (value: unknown): value is PenColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);

const isThickness = (value: unknown): value is PenThickness =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);

/** A usable flattened path: an even number of points' worth of real numbers. */
const isPointArray = (points: unknown): points is number[] =>
  Array.isArray(points) &&
  points.length >= 2 &&
  points.length % 2 === 0 &&
  points.every(isFiniteNumber);

/**
 * Tell the shared model that a `stroke` object exists, how small it may go, and how it is
 * read — here as well as in the client registry, so that a unit test or the Worker can read
 * a stroke with no DOM and no React in sight.
 */
registerObjectTypeModel('stroke', STROKE_MIN_SIZE_WORLD);
registerObjectTypeReader('stroke', readStrokeObject);

/** How thick this stroke's line is, in board units; an unknown word draws at medium. */
export const strokeThicknessWorld = (thickness: string): number =>
  isThickness(thickness) ? PEN_THICKNESS_WORLD[thickness] : PEN_THICKNESS_WORLD.medium;

/** What colour this stroke is drawn in; an unknown word draws in the default one. */
export const strokeColorCss = (color: string): string =>
  isColor(color) ? PEN_COLORS[color] : PEN_COLORS[DEFAULT_PEN_COLOR];

/**
 * How far from the line a point may be and still be on it, in board units at `zoom`
 * (`pen.select`).
 *
 * Two halves, and the tool needs both: six *screen* pixels, divided by the zoom so that it
 * is six pixels whether you are looking at the whole board or deep in a corner; and half the
 * line's own thickness, so that a thick line is as easy to hit as it is to see. The wider
 * wins, which is why zooming in on a thin line does not make it harder to click than it
 * looks — and why a thick line at 400% is still hit in the middle of its own ink.
 */
export const strokeHitToleranceWorld = (thickness: string, zoom: number): number =>
  Math.max(
    strokeThicknessWorld(thickness) / 2,
    STROKE_HIT_TOLERANCE_PX / (isFiniteNumber(zoom) && zoom > 0 ? zoom : 1),
  );

/**
 * How wide the stroke's invisible target is, in board units: twice the tolerance, because a
 * line is hit on either side of it. The component draws a stroke this wide and lets the
 * browser do the geometry, so the rule the tests check is the rule the pointer follows
 * (the same trick `connectorHitWidthWorld` plays).
 */
export const strokeHitWidthWorld = (thickness: string, zoom: number): number =>
  strokeHitToleranceWorld(thickness, zoom) * 2;

/**
 * Is this point on the drawing? Measured against the *scaled* line, so a stroke that has
 * been resized is hit where it is drawn and not where it was drawn (`pen.select`).
 */
export const hitTestStroke = (
  stroke: StrokeSnapshot,
  point: Point,
  zoom: number,
): boolean =>
  isFiniteNumber(zoom) &&
  zoom > 0 &&
  distanceToPolyline(scaledPoints(stroke), point) <=
    strokeHitToleranceWorld(stroke.thickness, zoom);

/**
 * The stored points as world coordinates, at the stroke's current size (`pen.resize`).
 *
 * This is the read side of the whole type: every number a screen draws comes from here, so
 * a fresh stroke, a resized stroke and one that has been moved twice all mean exactly what
 * they draw. `width / baseWidth` is 1 for anything nobody has scaled, which is the common
 * case and costs nothing.
 */
export function scaledPoints(stroke: StrokeSnapshot): Point[] {
  const points = stroke.points;
  // An object with no size written is an object nobody ever scaled: `objectBounds` gives it
  // one and the ratio is 1, which is the same answer from the other direction.
  const width = isFiniteNumber(stroke.width) ? stroke.width : stroke.baseWidth;
  const height = isFiniteNumber(stroke.height) ? stroke.height : stroke.baseHeight;
  const sx = isFiniteNumber(stroke.baseWidth) && stroke.baseWidth > 0 ? width / stroke.baseWidth : 1;
  const sy =
    isFiniteNumber(stroke.baseHeight) && stroke.baseHeight > 0 ? height / stroke.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({
      x: stroke.x + (points[i] as number) * sx,
      y: stroke.y + (points[i + 1] as number) * sy,
    });
  }
  return out;
}

/** The box of a raw path: where it is, padded by half the line so nothing is clipped. */
function pathBounds(points: readonly Point[], thickness: number): Rect {
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
  const pad = thickness / 2;
  // The box is the ink with half a line of air around it, and never smaller than the floor
  // a resize is held to — grown about its centre when it would be, so a dot stays a dot in
  // the middle of its own box rather than a dot in its corner. Nothing a stroke draws is
  // ever outside it, and there is never nothing to click on.
  let x = minX - pad;
  let y = minY - pad;
  let width = maxX - minX + thickness;
  let height = maxY - minY + thickness;
  if (width < STROKE_MIN_SIZE_WORLD) {
    x -= (STROKE_MIN_SIZE_WORLD - width) / 2;
    width = STROKE_MIN_SIZE_WORLD;
  }
  if (height < STROKE_MIN_SIZE_WORLD) {
    y -= (STROKE_MIN_SIZE_WORLD - height) / 2;
    height = STROKE_MIN_SIZE_WORLD;
  }
  return { x, y, width, height };
}

/**
 * Read one stroke out of the document, or null when the id is gone or belongs to another
 * kind.
 */
export function readStrokeSnapshot(doc: Y.Doc, id: string): StrokeSnapshot | null {
  return readStrokeObject(id, objectsMap(doc).get(id));
}

/** Every stroke on the board, in draw order. */
export function strokeSnapshots(doc: Y.Doc): StrokeSnapshot[] {
  const out: StrokeSnapshot[] = [];
  objectsMap(doc).forEach((value, key) => {
    const stroke = readStrokeObject(key, value);
    if (stroke) out.push(stroke);
  });
  return out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
}

/**
 * The same read from the `Y.Map` the board already holds: the reader `snapshotObjects` uses
 * for a stroke, *registered* rather than imported by `board-model` for the same reason as
 * `registerObjectTypeModel` — no cycle.
 *
 * A stroke whose points cannot be read is no stroke at all: the object stays in the document
 * where story 7 can still move and delete it, and draws nothing, which is what this codebase
 * does with a thing it cannot make sense of.
 */
export function readStrokeObject(
  id: string,
  object: Y.Map<unknown> | undefined,
): StrokeSnapshot | null {
  if (!isStroke(object)) return null;
  const points = object.get('points');
  if (!isPointArray(points)) return null;
  const createdBy = object.get('createdBy');
  const createdAt = object.get('createdAt');
  const width = object.get('width');
  const height = object.get('height');
  // `baseWidth`/`baseHeight` are what a render scales against; a stroke written by something
  // that forgot to store them is one that was never scaled.
  const baseWidth = object.get('baseWidth');
  const baseHeight = object.get('baseHeight');
  const color = object.get('color');
  const thickness = object.get('thickness');
  return {
    id,
    type: 'stroke',
    x: isFiniteNumber(object.get('x')) ? (object.get('x') as number) : 0,
    y: isFiniteNumber(object.get('y')) ? (object.get('y') as number) : 0,
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    width: isFiniteNumber(width) ? width : 0,
    height: isFiniteNumber(height) ? height : 0,
    points,
    baseWidth: isFiniteNumber(baseWidth) && baseWidth > 0 ? baseWidth : (width as number) || 0,
    baseHeight: isFiniteNumber(baseHeight) && baseHeight > 0 ? baseHeight : (height as number) || 0,
    color: isColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
    createdBy: typeof createdBy === 'string' ? createdBy : undefined,
    createdAt: isFiniteNumber(createdAt) ? createdAt : undefined,
  };
}

/** True for the kind that is a drawing rather than a box. */
export const isStrokeSnapshot = (object: BoardObject): object is StrokeSnapshot =>
  object.type === 'stroke';

/**
 * Draw `request` on the board and return its id, or null for a drawing that cannot exist
 * (`stroke.model`).
 *
 * One object, one `transact(LOCAL_ORIGIN)`, above everything else that is there, with the
 * path as it was handed over. Nothing here invents anything beyond the id and the box: the
 * tool has already recorded the path and already smoothed it, because smoothing depends on
 * the zoom the drawing happened at and this function has no idea what the screen is doing.
 */
export function createStroke(
  doc: Y.Doc,
  request: StrokeRequest,
  by: string,
): string | null {
  const { points, color, thickness } = request;
  // A drawing needs at least a place to be, and every number in it has to be a number: half
  // a coordinate would draw a line to somewhere that does not exist.
  if (points.length === 0) return null;
  for (const point of points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
  }
  // An unknown colour or thickness is not "draw it anyway in black": it is a request from
  // something that does not know what a pen offers (TC-05).
  if (!isColor(color) || !isThickness(thickness)) return null;

  const id = crypto.randomUUID();
  const size = strokeThicknessWorld(thickness);
  const box = pathBounds(points, size);
  // Flattened, and relative to the box's origin: this array is what every screen will read
  // back on every repaint, for as long as this board is kept.
  const relative: number[] = [];
  for (const point of points) {
    relative.push(point.x - box.x, point.y - box.y);
  }

  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    const z = value instanceof Y.Map ? value.get('z') : undefined;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', 'stroke');
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('points', relative);
    object.set('baseWidth', box.width);
    object.set('baseHeight', box.height);
    object.set('color', color);
    object.set('thickness', thickness);
    object.set('z', maxZ + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', typeof by === 'string' ? by : '');
    objectsMap(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}
