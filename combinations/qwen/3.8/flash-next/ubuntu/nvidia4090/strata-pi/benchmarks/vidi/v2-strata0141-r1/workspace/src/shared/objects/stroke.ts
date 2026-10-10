import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  registerSelectableType,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';

/**
 * The stroke model (`stroke.model`, `pen.draw`, `pen.dot`, `pen.share`).
 *
 * Schema (`objects/<id>`):
 *
 * ```
 * { type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *   points: number[],          // flattened [x0, y0, x1, y1, ...], bbox-relative
 *   baseWidth, baseHeight,     // the box the points were recorded at
 *   color: PenColor, thickness: PenThickness }
 * ```
 *
 * `x`/`y` is the top-left of the box, which is the recorded path **padded by half
 * the thickness**: a thick line's box reaches as far as its paint does, so a
 * stroke is selected, moved and marquee-ed exactly where it is drawn.
 *
 * Points are a plain array replaced atomically, never edited point by point: a
 * finished stroke is immutable (`pen.smooth`, "no editing individual points"), and
 * the only things that ever change are the generic `x`/`y`/`width`/`height` story 7
 * writes. `baseWidth`/`baseHeight` are the size the points were recorded at, so a
 * resize scales the line in proportion while its thickness stays what the pen was
 * set to (`pen.resize`).
 *
 * Like the rest of the shared model, nothing here throws for user input: an empty
 * path, a non-finite coordinate, an unknown colour or an unknown thickness is
 * refused before the transaction opens, so no `update` event is emitted and nobody
 * else is told about a stroke that does not exist (`TC-05`).
 */

export interface StrokeSnap extends ObjectSnapshot {
  readonly type: 'stroke';
  /** A stroke always has a box: it is where its line is drawn. */
  readonly width: number;
  readonly height: number;
  /** Always present for a stroke: the recorded path, in its box. */
  readonly points: readonly number[];
  /** The box the points were recorded at: render scale = width / baseWidth. */
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: PenColor;
  readonly thickness: PenThickness;
  readonly createdBy: string;
}

export interface CreateStrokeArgs {
  /** World-space points, in the order they were recorded. */
  readonly points: readonly Point[];
  readonly color: PenColor;
  readonly thickness: PenThickness;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPenColor = (value: unknown): value is PenColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);

const isPenThickness = (value: unknown): value is PenThickness =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** UUIDs, so two people drawing at the same moment cannot collide (story 3). */
function randomId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10)
    .join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` in the document (0 when it holds nothing). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

/**
 * A recorded path this model can store: at least one point, every coordinate
 * finite. `null` is the refusal - it is never an exception (`TC-05`).
 */
function usablePoints(points: readonly Point[]): Point[] | null {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  const out: Point[] = [];
  for (const point of points) {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return null;
    }
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

/** The recorded path's box, padded out by half the thickness on every side. */
function boxOf(points: readonly Point[], thickness: number): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const pad = thickness / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/**
 * Read one stored object as a stroke (`stroke.model`).
 *
 * Registered with the board model, so `objectSnapshots` - and with it selection,
 * marquee, move, resize and delete - reads a stroke without any stroke-specific
 * interaction code (`sel.all_types`).
 */
export function strokeFrom(id: string, value: unknown): StrokeSnap | undefined {
  const entry = asObjectMap(value);
  if (!entry || entry.get('type') !== 'stroke') {
    return undefined;
  }
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const width = entry.get('width');
  const height = entry.get('height');
  const baseWidth = entry.get('baseWidth');
  const baseHeight = entry.get('baseHeight');
  const raw = entry.get('points');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined; // a half-written stroke is not renderable
  }
  if (!Array.isArray(raw) || raw.length < 2 || raw.length % 2 !== 0) {
    return undefined; // no path to draw: nothing to select either
  }
  const points: number[] = [];
  for (const value of raw) {
    if (!isFiniteNumber(value)) {
      return undefined;
    }
    points.push(value);
  }
  return Object.freeze({
    id,
    type: 'stroke' as const,
    x,
    y,
    width,
    height,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    points: Object.freeze(points),
    baseWidth: isFiniteNumber(baseWidth) && baseWidth > 0 ? baseWidth : width,
    baseHeight: isFiniteNumber(baseHeight) && baseHeight > 0 ? baseHeight : height,
    color: isPenColor(entry.get('color')) ? (entry.get('color') as PenColor) : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(entry.get('thickness'))
      ? (entry.get('thickness') as PenThickness)
      : DEFAULT_PEN_THICKNESS,
    createdBy: typeof entry.get('createdBy') === 'string' ? (entry.get('createdBy') as string) : '',
  });
}

registerSelectableType('stroke');
registerSnapshotReader('stroke', strokeFrom);

/** One stored stroke, read as a snapshot. */
export function readStrokeSnapshot(doc: Y.Doc, id: string): StrokeSnap | undefined {
  if (typeof id !== 'string' || id === '') {
    return undefined;
  }
  return strokeFrom(id, objectsOf(doc).get(id));
}

/**
 * Create a stroke (`pen.draw`, `pen.dot`, `pen.share`).
 *
 * One `LOCAL_ORIGIN` transaction: type, box, points relative to the box,
 * `baseWidth`/`baseHeight`, `z = maxZ + 1`, createdAt, createdBy, colour and
 * thickness. That single transaction is the whole of `pen.share`: story 3 delivers
 * it to every other person within `LIVE_UPDATE_LATENCY_BUDGET_MS`, and it is one
 * undo step for the person who drew it (`pen.long_stroke`'s parts count the same
 * way, because each part is one call to this function).
 *
 * A click - one point - is a dot (`pen.dot`): the box is the thickness square the
 * round-capped path paints, and the one point sits in its middle.
 *
 * `null` refuses without writing anything: an empty path, a non-finite coordinate,
 * an unknown colour or an unknown thickness (`TC-05`).
 */
export function createStroke(
  doc: Y.Doc,
  args: CreateStrokeArgs,
  by: string,
): string | null {
  if (!args) {
    return null;
  }
  const points = usablePoints(args.points);
  if (!points) {
    return null;
  }
  if (!isPenColor(args.color) || !isPenThickness(args.thickness)) {
    return null;
  }
  if (typeof by !== 'string') {
    return null;
  }
  const thickness = PEN_THICKNESS_WORLD[args.thickness];
  const box = boxOf(points, thickness);
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height) || box.width <= 0 || box.height <= 0) {
    return null;
  }

  // Flattened, relative to the box origin, at the size it was recorded at.
  const stored: number[] = [];
  for (const point of points) {
    stored.push(point.x - box.x, point.y - box.y);
  }

  const id = randomId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', 'stroke');
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('points', stored);
    object.set('baseWidth', box.width);
    object.set('baseHeight', box.height);
    object.set('color', args.color);
    object.set('thickness', args.thickness);
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's points at the size it is **now** (`pen.resize`).
 *
 * They come out in the stroke's own space - the same coordinates the SVG draws in
 * and the coordinates a click is measured against - because the box may have been
 * dragged anywhere. Each stored point is scaled by the box's change, so the drawn
 * line grows in proportion and keeps its width-to-height ratio; the thickness is
 * not in here at all, which is exactly why resizing never thickens a line.
 */
export function scaledPoints(stroke: StrokeSnap): Point[] {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) {
    return [];
  }
  const scaleX =
    isFiniteNumber(stroke.baseWidth) && stroke.baseWidth > 0 ? stroke.width / stroke.baseWidth : 1;
  const scaleY =
    isFiniteNumber(stroke.baseHeight) && stroke.baseHeight > 0 ? stroke.height / stroke.baseHeight : 1;
  const points: Point[] = [];
  for (let index = 0; index + 1 < stroke.points.length; index += 2) {
    points.push({
      x: (stroke.points[index] ?? 0) * scaleX,
      y: (stroke.points[index + 1] ?? 0) * scaleY,
    });
  }
  return points;
}

/**
 * The stroke's points as world points - where its line actually is, for anything
 * that measures a stroke against the rest of the board (a test hook, a toolbar).
 */
export function worldPoints(stroke: StrokeSnap): Point[] {
  return scaledPoints(stroke).map((point) => ({ x: stroke.x + point.x, y: stroke.y + point.y }));
}
