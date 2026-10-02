// Pen strokes: what a freehand drag leaves on the board.
//
// A stroke is an ordinary entry in the board's one `objects` map, made the same way
// every other object is: the id is generated here, the whole entry is written in ONE
// transaction with `LOCAL_ORIGIN`, and so one stroke is one undo step, one broadcast
// and one Y.Map — never half a drawing.
//
// What is stored is not the path that is drawn but the points it was drawn through,
// as a flat array of numbers **relative to the box the stroke was made in**, plus that
// box's size at the time (`baseWidth`, `baseHeight`). Points are relative because a
// stroke that stored absolute places would have to be rewritten point by point every
// time somebody resized it, and a stroke that was rewritten point by point is a
// drawing somebody else could half-receive. They are stored at the size they were
// drawn at and scaled on the way out (`scaledPoints`) because the resize machinery
// story 7 built only knows how to change `x`, `y`, `width` and `height`, and that is
// all a resize of a drawing should touch.
//
// The array is replaced whole and never edited point by point, which is the reason it
// can be a plain number array inside the object's Y.Map rather than a shared type of
// its own: a stroke is finished once and after that only its box changes.
//
// The thickness is stored as a palette key and never as a number, exactly as a sticky
// note stores its colour, so a document written before a palette changed is still
// readable — and so that resizing a drawing scales the drawing and leaves the width
// of the pen that drew it alone.

import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  isPenColor,
  isPenThickness,
  type PenColor,
  type PenThickness,
} from '../config';
import { getObjects, isFiniteNumber, LOCAL_ORIGIN, maxZ, newId } from '../board-model';
import { distanceToPolyline } from '../geometry/polyline';
import type { Point } from '../geometry';

export type { PenColor, PenThickness } from '../config';

/**
 * A stroke as it is read back out of the document.
 *
 * `points` is the flattened pair list, relative to (`x`, `y`) and at
 * (`baseWidth`, `baseHeight`); `scaledPoints` is the only function that turns it into
 * places on the board.
 */
export interface StrokeSnapshot {
  id: string;
  type: 'stroke';
  /** Top-left of the box the stroke is drawn in, board units. */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  /** [x0, y0, x1, y1, ...] relative to (`x`, `y`), at the size it was drawn at. */
  points: readonly number[];
  /** The box's size when the stroke was drawn: what `scaledPoints` scales from. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  createdBy?: string;
}

/** The design's name for the same snapshot, kept so both vocabularies work. */
export type StrokeSnap = StrokeSnapshot;

/** What a finished stroke is made from: the points the pointer went through, in
 *  board units, and the pen it was drawn with. */
export interface StrokeCreation {
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

/** A point is usable when both of its numbers are numbers in the ordinary sense. */
function isPoint(value: unknown): value is Point {
  if (value === null || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

/**
 * The points a stroke may be made from, or null for a drawing that cannot be kept.
 *
 * All of them are checked before anything is written, so a stroke with one `NaN` in
 * it is refused as a whole rather than stored as half a line: a document that held
 * coordinates which were not numbers would be a document that every later reader
 * would have to guess at.
 */
function usable(points: readonly Point[] | undefined | null): Point[] | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  const clean: Point[] = [];
  for (const point of points) {
    if (!isPoint(point)) return null;
    clean.push({ x: point.x, y: point.y });
  }
  return clean;
}

/**
 * The box a stroke is drawn in: the extent of its points, with half the pen's
 * thickness added all the way round.
 *
 * The padding is what stops a stroke from being clipped by its own box: the line is
 * painted half a thickness on either side of the points it goes through, so a box that
 * stopped at the points would cut the outside of the line off. For a single point that
 * makes the box exactly a square of the thickness, which is the dot — the round cap of
 * a path of no length then paints the whole of it and nothing outside it.
 */
export function strokeBox(points: readonly Point[], thickness: PenThickness): { x: number; y: number; width: number; height: number } {
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
  const half = PEN_THICKNESS_WORLD[thickness] / 2;
  return {
    x: minX - half,
    y: minY - half,
    width: maxX - minX + half * 2,
    height: maxY - minY + half * 2,
  };
}

/**
 * Add a stroke and return its id, or return null and write nothing when there is
 * nothing to draw, when a coordinate is not a number, or when the colour or the
 * thickness is a name this board does not have.
 *
 * One transaction: the points, their box, the pen, `z` above every object already
 * there, `createdAt` and `createdBy` when there is a person to name. Nothing about a
 * stroke is written in a second transaction, so Undo takes a drawing away in one
 * press and brings it back in one more.
 */
export function createStroke(doc: Y.Doc, creation: StrokeCreation, by?: string): string | null {
  const points = usable(creation?.points);
  if (points === null) return null;
  if (!isPenColor(creation.color)) return null;
  if (!isPenThickness(creation.thickness)) return null;

  const box = strokeBox(points, creation.thickness);
  // Relative to the box, at the size the box was made: the drawing as a shape rather
  // than as a set of places.
  const flat: number[] = [];
  for (const point of points) {
    flat.push(point.x - box.x, point.y - box.y);
  }

  const objects = getObjects(doc);
  const id = newId();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'stroke');
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('points', flat);
    map.set('baseWidth', box.width);
    map.set('baseHeight', box.height);
    map.set('color', creation.color);
    map.set('thickness', creation.thickness);
    map.set('z', maxZ(objects) + 1);
    if (by !== undefined && by !== '') map.set('createdBy', by);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Where the drawing is now that its box is the size it is: the stored points put back
 * through the ratio between the box the stroke was drawn in and the box it is in.
 *
 * Both directions by their own ratio, because a box is dragged wider or taller on its
 * own and a drawing that kept its proportions would not fill the box somebody dragged.
 * (Keeping the proportions is the selection overlay's business — the registry says
 * `aspectLocked`, and the handles honour that — so the two ratios are only ever
 * different when something bypassed them.)
 *
 * The pen's thickness is not in this function at all, and that is the point: a resize
 * scales the drawing and leaves the pen it was drawn with alone.
 */
export function scaledPoints(stroke: StrokeSnapshot): Point[] {
  const points = stroke.points;
  if (!Array.isArray(points) || points.length < 2) return [];
  const sx = stroke.baseWidth > 0 ? stroke.width / stroke.baseWidth : 1;
  const sy = stroke.baseHeight > 0 ? stroke.height / stroke.baseHeight : 1;
  const result: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    result.push({ x: stroke.x + x * sx, y: stroke.y + y * sy });
  }
  return result;
}

/**
 * Is this board point on this stroke's line?
 *
 * A stroke is not a box and is not selected by one. The corridor is `STROKE_HIT_TOLERANCE_PX`
 * screen pixels wide at whatever zoom the click was made at — six pixels at 50 %, at
 * 100 % and at 200 % alike — or half the stroke's own thickness, whichever is wider,
 * because a click inside a fat line is on it however far it is from the middle.
 *
 * The consequence the story asks for: a click inside the stroke's bounding box but
 * away from its line is not on the stroke, and falls through to whatever is underneath.
 */
export function strokeHitTest(stroke: StrokeSnapshot, worldPoint: Point, zoom: number): boolean {
  const line = scaledPoints(stroke);
  if (line.length === 0) return false;
  const corridor = STROKE_HIT_TOLERANCE_PX / (isFiniteNumber(zoom) && zoom > 0 ? zoom : 1);
  const reach = Math.max(PEN_THICKNESS_WORLD[stroke.thickness] / 2, corridor);
  return distanceToPolyline(worldPoint, line) <= reach;
}

/**
 * The colour a stroke is drawn in, falling back to the default for a document that
 * named a colour this board has no swatch for.
 */
export function penColorOf(color: string): string {
  return isPenColor(color) ? PEN_COLORS[color] : PEN_COLORS[DEFAULT_PEN_COLOR];
}

/** The pen's thickness in board units, likewise. */
export function penThicknessOf(thickness: string): number {
  return isPenThickness(thickness) ? PEN_THICKNESS_WORLD[thickness] : PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
}

/**
 * Read a stored stroke. Exported for `board-model`, which owns the reading of every
 * object and so is the only place that decides what a damaged stroke means.
 *
 * The box is taken as stored — it is what the selection, the resize and the delete
 * machinery all work on — but a stroke whose points are unusable is not on the board:
 * there is nothing to draw and nothing to click, and an object that cannot be drawn is
 * one the renderer should not be handed.
 */
export function readStroke(map: Y.Map<unknown>, id: string): StrokeSnapshot | null {
  const stored = map.get('points');
  if (!Array.isArray(stored)) return null;
  const points: number[] = [];
  for (const value of stored) {
    if (!isFiniteNumber(value)) return null;
    points.push(value);
  }
  if (points.length < 2) return null;

  const color = map.get('color');
  const thickness = map.get('thickness');
  const createdBy = map.get('createdBy');
  const width = map.get('width');
  const height = map.get('height');
  // A stroke always has a box: it is what the selection, the resize and the delete
  // machinery all hold, and one that lost it has no place on the board.
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  const baseWidth = map.get('baseWidth');
  const baseHeight = map.get('baseHeight');

  return Object.freeze({
    id,
    type: 'stroke' as const,
    x: map.get('x') as number,
    y: map.get('y') as number,
    // A stroke that lost its base size was drawn at the size it is: without a second
    // number to scale from there is nothing to scale by.
    width: width as number,
    height: height as number,
    z: map.get('z') as number,
    createdAt: map.get('createdAt') as number,
    points,
    baseWidth: isFiniteNumber(baseWidth) && baseWidth > 0 ? baseWidth : (width as number),
    baseHeight: isFiniteNumber(baseHeight) && baseHeight > 0 ? baseHeight : (height as number),
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
    ...(typeof createdBy === 'string' && createdBy !== '' ? { createdBy } : {}),
  });
}
