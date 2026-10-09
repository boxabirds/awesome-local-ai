import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import {
  LOCAL_ORIGIN,
  newObjectId,
  topZ,
  type ObjectSnapshotBase,
} from '../board-model';
import type { Point } from '../geometry';

/**
 * The `stroke` object type (story 11): one freehand line the Pen tool drew, kept as an
 * ordinary board object so it can be selected by its line, moved, resized in proportion and
 * deleted with none of that code knowing strokes exist.
 *
 * Schema — the same entry of `objects` every other type has, plus:
 *
 *     points: number[]        // flattened [x0, y0, …] relative to the box origin, at creation size
 *     baseWidth, baseHeight   // the box at creation: render scale = width / baseWidth
 *     color: PenColor, thickness: PenThickness, createdBy, createdAt
 *
 * The points are relative to the box rather than absolute so a move writes two numbers and a
 * resize writes two more; they are stored at the size the stroke was drawn at so a resize can
 * scale them without any of the old coordinates being rewritten, and without the drawing
 * drifting each time it is resized.
 *
 * A stroke is immutable after it is made: only the generic `x`, `y`, `width` and `height`
 * change afterwards (story 7's move and resize), which is why the points can be one plain array
 * replaced atomically rather than a shared type edited point by point — a stroke being drawn is
 * not in the document at all (design: pen.tool).
 */

/** The object type this module owns. */
export const STROKE_TYPE = 'stroke';

/** A pen colour or thickness is one of the settings' keys, and that is the type that says so. */
export type { PenColor, PenThickness };

/** What a thickness means in board units, and 0 for a thickness nobody offered. */
export function penThicknessWorld(thickness: PenThickness): number {
  return PEN_THICKNESS_WORLD[thickness] ?? 0;
}

/** A stroke as one read of the document saw it. */
export interface StrokeSnap extends ObjectSnapshotBase {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, …], relative to the box origin, at `baseWidth` × `baseHeight`. */
  points: readonly number[];
  /** The box the stroke was drawn in: the drawing scales by `width / baseWidth`. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  /** The device that drew it (story 6 hands out the id; today it is this tab's). */
  createdBy: string;
  createdAt: number;
  known: true;
}

/** Is this one of ours? `type` is any string once a document has been synced. */
export function isStrokeSnapshot(object: { type: string } | undefined): object is StrokeSnap {
  return object?.type === STROKE_TYPE;
}

/** Runtime validation: a synced document can hold anything in place of a colour. */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

/** Runtime validation of a thickness name. */
export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

/** The CSS colour a pen colour paints with. */
export function penColorValue(color: PenColor): string {
  return PEN_COLORS[color] ?? PEN_COLORS.black;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>('objects');
}

function objectOf(doc: Y.Doc, id: string): YObject | undefined {
  if (!id) return undefined;
  const item = objectsOf(doc).get(id);
  return item instanceof Y.Map ? item : undefined;
}

function numberOf(item: YObject, key: string, fallback: number): number {
  const value = item.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The points as they were stored, skipping anything that is not a pair of finite numbers. */
function pointsOf(item: YObject): number[] {
  const raw = item.get('points');
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const value of raw) {
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  // A half-written pair is not a point.
  if (out.length % 2 !== 0) out.pop();
  return out;
}

function pairsOf(points: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    out.push({ x: points[index], y: points[index + 1] });
  }
  return out;
}

/**
 * A stroke read out of the document, or undefined when `id` is gone or is another type.
 * `objectSnapshots` uses the same reading, so the board's list and this function never disagree
 * about what a stroke holds.
 */
export function readStroke(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== STROKE_TYPE) return undefined;
  return strokeSnapshotOf(id, item);
}

/** The reading `board-model` uses when it walks the whole objects map. */
export function readStrokeObject(id: string, item: YObject): StrokeSnap | undefined {
  if (item.get('type') !== STROKE_TYPE) return undefined;
  return strokeSnapshotOf(id, item);
}

function strokeSnapshotOf(id: string, item: YObject): StrokeSnap {
  const createdBy = item.get('createdBy');
  const color = item.get('color');
  const thickness = item.get('thickness');
  const width = numberOf(item, 'width', 0);
  const height = numberOf(item, 'height', 0);
  // A stroke that lost its creation size cannot be scaled, so it is drawn as it is stored.
  const baseWidth = numberOf(item, 'baseWidth', width);
  const baseHeight = numberOf(item, 'baseHeight', height);
  return {
    id,
    type: STROKE_TYPE,
    x: numberOf(item, 'x', 0),
    y: numberOf(item, 'y', 0),
    z: numberOf(item, 'z', 0),
    width: Math.max(width, 0),
    height: Math.max(height, 0),
    known: true,
    points: pointsOf(item),
    baseWidth: Math.max(baseWidth, 0),
    baseHeight: Math.max(baseHeight, 0),
    color: isPenColor(color) ? color : 'black',
    thickness: isPenThickness(thickness) ? thickness : 'medium',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: numberOf(item, 'createdAt', 0),
  };
}

/** Where the line's box sits, given the points and how thick the line is. */
export function strokeBounds(
  points: readonly Point[],
  thickness: PenThickness,
): { x: number; y: number; width: number; height: number } | null {
  const pts = points ?? [];
  if (pts.length === 0) return null;
  let minX = pts[0].x;
  let maxX = pts[0].x;
  let minY = pts[0].y;
  let maxY = pts[0].y;
  for (const point of pts) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  // The box is padded by half the thickness, so the round cap of the line is inside it and the
  // selection box the user sees is the line they drew rather than a box of empty space.
  const pad = penThicknessWorld(thickness) / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/**
 * Draws a stroke: one freehand line, from the points the Pen tool recorded in board units.
 *
 * Returns its id, or null when there are no points, one of them is not a finite number, or the
 * colour or thickness is not one the settings offer — in every one of those cases the document
 * is not touched, not even by an empty transaction.
 *
 * A single point is a legitimate stroke: it is what a click with the Pen tool is, and its box is
 * the thickness square, so it is a dot of the thickness it was drawn with (`pen.dot`).
 *
 * The new stroke is on top of everything (`z = topZ(doc) + 1`).
 */
export function createStroke(
  doc: Y.Doc,
  input: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const { points, color, thickness } = input ?? { points: [], color: 'black', thickness: 'thin' };
  if (!Array.isArray(points) || points.length === 0) return null;
  if (!isPenColor(color) || !isPenThickness(thickness)) return null;
  const bounds = strokeBounds(points, thickness);
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const flat: number[] = [];
  for (const point of points) {
    flat.push(point.x - bounds.x, point.y - bounds.y);
  }

  const id = newObjectId();
  doc.transact(() => {
    const item = new Y.Map<unknown>();
    item.set('type', STROKE_TYPE);
    item.set('x', bounds.x);
    item.set('y', bounds.y);
    item.set('width', bounds.width);
    item.set('height', bounds.height);
    item.set('points', flat);
    item.set('baseWidth', bounds.width);
    item.set('baseHeight', bounds.height);
    item.set('color', color);
    item.set('thickness', thickness);
    item.set('z', topZ(doc) + 1);
    item.set('createdAt', Date.now());
    item.set('createdBy', typeof by === 'string' ? by : '');
    objectsOf(doc).set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The points of a stroke where they are now, in board units: the stored points scaled by how
 * much its box has grown or shrunk since it was drawn (`pen.resize`).
 *
 * This is what hit-testing runs on, so a stroke that has been resized is clicked on the line it
 * is drawn on rather than the line it was drawn on, and what a renderer draws. Thickness is a
 * property of the line rather than of its box, so it does not appear here at all.
 */
export function scaledPoints(stroke: StrokeSnap): Point[] {
  const stored = pairsOf(stroke.points ?? []);
  const sx = stroke.baseWidth > 0 ? stroke.width / stroke.baseWidth : 1;
  const sy = stroke.baseHeight > 0 ? stroke.height / stroke.baseHeight : 1;
  return stored.map((point) => ({
    x: stroke.x + point.x * sx,
    y: stroke.y + point.y * sy,
  }));
}
