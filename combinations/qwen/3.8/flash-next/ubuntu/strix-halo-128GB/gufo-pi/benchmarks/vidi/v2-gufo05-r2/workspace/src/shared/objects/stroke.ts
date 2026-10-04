/**
 * Story 11: the stroke object — a freehand drawing that is an ordinary board object.
 *
 * The decision this file is built on (design key decision) is that a sketch is *not* a
 * layer of ink and *is* an object: once the pen is lifted, the stroke joins the notes,
 * shapes and arrows on the same map, with the same `x`, `y`, `width` and `height` as
 * everybody else, and story 7's move, resize and delete apply to it untouched. Nothing
 * in this file selects, moves or resizes anything.
 *
 * What a stroke stores on top of the common fields is its points, in the flat form
 * `[x0, y0, x1, y1, …]`, **relative to the box they were drawn into** and **at the size
 * that box had at the time**, plus that original size as `baseWidth`/`baseHeight`. Two
 * things follow from that:
 *
 * - The array is written once and never edited. A Yjs `Y.Array` would let two people
 *   add points to one stroke; nobody can, because a stroke is finished before it exists.
 *   A plain value inside the object's `Y.Map` is replaced atomically, and that is the
 *   whole conflict story.
 * - A resize is a multiplication, not a rewrite. `scaledPoints` scales the stored points
 *   by `width / baseWidth`, so dragging a corner handle scales the drawing in proportion
 *   (PRD pen.resize) while the pen's weight — which is stored, not derived — stays the
 *   thickness of the pen that made it.
 *
 * A document written before story 11 has no `stroke` entries in it; a stroke entry
 * arrived at with rubbish in it reads back as an empty path with the default style, so
 * there is nothing to migrate and nothing that fails to draw.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { polylineBounds } from '../geometry/polyline';

export type { PenColor, PenThickness };

/** What a stroke stores on top of the common fields. */
export interface StrokeSnapshot extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened `[x0, y0, …]`, relative to the box's origin, at the creation size. */
  points: readonly number[];
  /** The box's size when the stroke was drawn: the other scale factor's denominator. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** A colour the board can draw, out of the six the pen offers. */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.hasOwn(PEN_COLORS, value);
}

/** A weight the board can draw, out of the three the pen offers. */
export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.hasOwn(PEN_THICKNESS_WORLD, value);
}

/**
 * The path a create request holds: at least one point, and every one of them a place.
 *
 * A single non-finite coordinate refuses the whole stroke rather than being dropped —
 * a stroke missing a third of itself is worse than one that was never started, and the
 * pen's own rule is that a rejected stroke clears the preview silently.
 */
export function isDrawablePath(points: unknown): points is readonly Point[] {
  if (!Array.isArray(points) || points.length === 0) return false;
  return points.every(
    (point) =>
      !!point &&
      typeof point === 'object' &&
      Number.isFinite((point as Point).x) &&
      Number.isFinite((point as Point).y),
  );
}

/**
 * Finish a stroke: put the drawing on the board as an object and return its id.
 *
 * The box is the box of the points, padded by half the pen's thickness, so the ink —
 * which strays half its width either side of the line — is never clipped, and a click
 * (one point) lands in a square of exactly the thickness: the round-capped dot (PRD
 * pen.dot).
 *
 * Null, with no transaction, for a request that cannot be drawn: no points, a point
 * that is not a place, a colour or a weight that is not on the palette.
 */
export function createStroke(
  doc: Y.Doc,
  input: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
  now = Date.now(),
): string | null {
  if (!isDrawablePath(input?.points)) return null;
  if (!isPenColor(input.color)) return null;
  if (!isPenThickness(input.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[input.thickness];
  const bounds = polylineBounds(input.points);
  const x = bounds.x - thickness / 2;
  const y = bounds.y - thickness / 2;
  const width = bounds.width + thickness;
  const height = bounds.height + thickness;

  // Relative to the box, so a move costs nothing and a resize is one multiplication.
  const flat: number[] = [];
  for (const point of input.points) {
    flat.push(point.x - x, point.y - y);
  }

  const id = crypto.randomUUID();
  const z = maxZ(objectsMap(doc)) + 1;
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'stroke');
    entry.set('x', x);
    entry.set('y', y);
    entry.set('width', width);
    entry.set('height', height);
    entry.set('z', z);
    entry.set('createdAt', now);
    entry.set('createdBy', by);
    entry.set('points', flat);
    entry.set('baseWidth', width);
    entry.set('baseHeight', height);
    entry.set('color', input.color);
    entry.set('thickness', input.thickness);
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The drawing as it looks right now, in board units relative to the object's box: the
 * stored points multiplied by however much the box has grown since they were written.
 *
 * The pen's weight is not here, because it does not scale: a stroke resized to twice
 * the size is the same thickness of line, twice as long (PRD pen.resize).
 */
export function scaledPoints(stroke: StrokeSnapshot): Point[] {
  const flat = stroke.points;
  if (!Array.isArray(flat)) return [];
  const sx = scale(stroke.width, stroke.baseWidth);
  const sy = scale(stroke.height, stroke.baseHeight);
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const px = flat[i];
    const py = flat[i + 1];
    if (typeof px !== 'number' || typeof py !== 'number') continue;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    out.push({ x: px * sx, y: py * sy });
  }
  return out;
}

/**
 * How much the box has grown since the stroke was drawn: 1 unless somebody resized it.
 *
 * A base size of zero (a stroke written by a client that does not know what it was
 * writing) scales by 1, so the drawing is at least its own size rather than infinity.
 */
function scale(size: number | undefined, base: number): number {
  if (!(base > 0) || typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return 1;
  return size / base;
}

/** Narrow a snapshot read from the board back to a stroke. */
export function isStrokeSnapshot(obj: ObjectSnapshot): obj is StrokeSnapshot {
  return obj.type === 'stroke';
}

/** Read one stored stroke, or null when the id is gone or is not a stroke. */
export function readStroke(doc: Y.Doc, id: string): StrokeSnapshot | null {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== 'stroke') return null;
  return strokeSnapshotOf(id, entry);
}

/** Every stroke on the board, in the order the document lists them. */
export function readStrokes(doc: Y.Doc): StrokeSnapshot[] {
  const out: StrokeSnapshot[] = [];
  for (const [id, entry] of objectsMap(doc)) {
    if (entry.get('type') === 'stroke') out.push(strokeSnapshotOf(id, entry));
  }
  return out;
}

/** The stroke fields of a stored entry, with defaults for anything missing. */
export function strokeSnapshotOf(id: string, entry: Y.Map<unknown>): StrokeSnapshot {
  const color = entry.get('color');
  const thickness = entry.get('thickness');
  const stored = entry.get('points');
  return {
    id,
    type: 'stroke',
    x: num(entry.get('x')),
    y: num(entry.get('y')),
    width: num(entry.get('width')),
    height: num(entry.get('height')),
    z: num(entry.get('z')),
    createdAt: num(entry.get('createdAt')),
    createdBy: typeof entry.get('createdBy') === 'string' ? (entry.get('createdBy') as string) : undefined,
    points: Array.isArray(stored) ? stored.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) : [],
    baseWidth: num(entry.get('baseWidth')),
    baseHeight: num(entry.get('baseHeight')),
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
  };
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const entry of objects.values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}
