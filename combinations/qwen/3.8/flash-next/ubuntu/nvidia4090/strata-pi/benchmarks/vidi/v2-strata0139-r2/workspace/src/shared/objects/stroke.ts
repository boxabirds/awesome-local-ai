import * as Y from "yjs";
import { LOCAL_ORIGIN, type ObjectSnapshot } from "../board-model";
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MIN_SIZE_WORLD,
  type PenColor,
  type PenThickness,
} from "../config";
import type { Point } from "../geometry";

/**
 * `stroke.model` — the document fields of a freehand drawing (story 11).
 *
 * A stroke is the base object (`id, type, x, y, width, height, z, createdAt,
 * createdBy`) plus four fields of its own:
 *
 *   `points`     the drawn points, flattened `[x, y, x, y, …]`, in **object
 *                coordinates** — relative to the box's own top-left corner, so a
 *                renderer and a hit test never need a second copy of the box
 *   `baseWidth`  the width the box had when the stroke was drawn
 *   `baseHeight` the height it had then
 *   `color`      a `PenColor` name; `PEN_COLORS` gives the hex
 *   `thickness`  a `PenThickness` name; `PEN_THICKNESS_WORLD` gives board units
 *
 * The box is the points' bounding box grown by half the thickness, so the drawn
 * line — with its round cap — fits exactly inside it and every generic board
 * gesture (select, move, resize, delete, z-order) works on a stroke unchanged.
 *
 * `baseWidth`/`baseHeight` are what makes `pen.resize` honest: resizing changes
 * only the box, and `scaledPoints` maps the stored points into whatever box the
 * stroke has now. Because a resize must keep the aspect ratio, the two scale
 * factors are equal and the drawn line keeps its shape. A single-point dot is a
 * square box, so it scales too.
 *
 * One `createStroke` call is one `Y.transact(..., LOCAL_ORIGIN)`, so it is one
 * undo step and one broadcast.
 */

export const STROKE_TYPE = "stroke";

/** One drawn stroke in the board snapshot. */
export interface StrokeSnap extends ObjectSnapshot {
  readonly type: "stroke";
  /** A stroke always has a box: its points' bounding box grown by the padding. */
  readonly width: number;
  readonly height: number;
  /** Flattened `[x, y, …]` in object coordinates (relative to the box origin). */
  readonly points: readonly number[];
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: PenColor;
  readonly thickness: PenThickness;
}

/** What `createStroke` takes: a path, a colour, a thickness. */
export interface CreateStrokeArgs {
  readonly points: readonly Point[];
  readonly color: PenColor;
  readonly thickness: PenThickness;
  /** Whose drawing this is; recorded as `createdBy` when given. */
  readonly createdBy?: string;
}

/** How far the box grows past the drawn points, on each side. */
function paddingFor(thickness: number): number {
  // Never smaller than half the model minimum, so every stroke — a thin dot
  // included — can take part in a resize the model will accept.
  return Math.max(thickness / 2, STROKE_MIN_SIZE_WORLD / 2);
}

/**
 * `createStroke(doc, { points, color, thickness }, by) -> id | null`
 *
 * Adds one stroke and returns its id, or null for input the model cannot store:
 * no points, a point that is not a pair of finite numbers, an unknown colour or an
 * unknown thickness. A rejected call writes nothing at all — no transaction, so no
 * update reaches the other screens and nothing lands on the undo stack.
 */
export function createStroke(
  doc: Y.Doc,
  args: CreateStrokeArgs,
  by?: string,
): string | null {
  const points = readPoints(args?.points);
  if (points === null) return null;

  const color = args.color;
  if (typeof color !== "string" || !Object.prototype.hasOwnProperty.call(PEN_COLORS, color)) return null;
  const thickness = args.thickness;
  if (typeof thickness !== "string" || !Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, thickness)) return null;

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const pad = paddingFor(thicknessWorld);

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

  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;

  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const id = newId();
  const z = maxZ(objects) + 1;
  const createdAt = Date.now();
  // The flattened path, in object coordinates.
  const stored: number[] = [];
  for (const point of points) {
    stored.push(point.x - x, point.y - y);
  }

  doc.transact(() => {
    const stroke = new Y.Map<unknown>();
    stroke.set("type", STROKE_TYPE);
    stroke.set("x", x);
    stroke.set("y", y);
    stroke.set("width", width);
    stroke.set("height", height);
    stroke.set("points", stored);
    stroke.set("baseWidth", width);
    stroke.set("baseHeight", height);
    stroke.set("color", color);
    stroke.set("thickness", thickness);
    stroke.set("z", z);
    stroke.set("createdAt", createdAt);
    if (typeof by === "string" && by.length > 0) stroke.set("createdBy", by);
    objects.set(id, stroke);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * `scaledPoints(stroke) -> Point[]`
 *
 * The stroke's points in **board coordinates**: the stored path mapped from the box
 * it was drawn into (`baseWidth`, `baseHeight`) to the box it has now, then moved
 * into the board by the box's own origin. A stroke that has never been resized
 * maps by exactly 1, so this is the path as it was drawn.
 *
 * Both scale factors are used — a stroke that has been stretched non-uniformly (by
 * a model call, since no gesture does that) scales its two axes independently,
 * which is what makes the rendered line match the box the selection handles show.
 */
export function scaledPoints(stroke: StrokeSnap): Point[] {
  const flat = Array.isArray(stroke?.points) ? stroke.points : [];
  const baseWidth = numberOr(stroke?.baseWidth, 0);
  const baseHeight = numberOr(stroke?.baseHeight, 0);
  const scaleX = baseWidth > 0 ? numberOr(stroke?.width, baseWidth) / baseWidth : 1;
  const scaleY = baseHeight > 0 ? numberOr(stroke?.height, baseHeight) / baseHeight : 1;
  const originX = numberOr(stroke?.x, 0);
  const originY = numberOr(stroke?.y, 0);

  const points: Point[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    const px = flat[index]!;
    const py = flat[index + 1]!;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    points.push({ x: originX + px * scaleX, y: originY + py * scaleY });
  }
  return points;
}

/** The thickness of a stroke in board units. */
export function strokeThicknessWorld(stroke: StrokeSnap): number {
  const thickness = PEN_THICKNESS_WORLD[stroke?.thickness as PenThickness];
  return Number.isFinite(thickness) ? thickness : PEN_THICKNESS_WORLD.medium;
}

/** The colour of a stroke as a hex string. */
export function strokeColorHex(stroke: StrokeSnap): string {
  const color = PEN_COLORS[stroke?.color as PenColor];
  return typeof color === "string" ? color : PEN_COLORS.black;
}

/** Does this snapshot read as a stroke the model can draw? */
export function isStrokeSnap(object: ObjectSnapshot | undefined | null): object is StrokeSnap {
  return object?.type === STROKE_TYPE && Array.isArray((object as StrokeSnap).points);
}

// ---- internals ------------------------------------------------------------

/** A usable path, or null when the input is not one. */
function readPoints(points: unknown): Point[] | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  const result: Point[] = [];
  for (const point of points) {
    if (point === null || typeof point !== "object") return null;
    const x = (point as Point).x;
    const y = (point as Point).y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    result.push({ x, y });
  }
  return result;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const value of objects.values()) {
    if (!(value instanceof Y.Map)) continue;
    const z = value.get("z");
    if (typeof z === "number" && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
