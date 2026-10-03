/**
 * The shape object: a rectangle, ellipse or diamond with a centred label (`shape.model`).
 *
 * A shape carries the common fields every board object has (position, size, stacking
 * order, creation time), plus a `kind`, a `fill` and `stroke` name from the two palettes,
 * and a `label` held in a `Y.Text` so two people typing into the same label merge the way
 * a note's text and free text do.
 *
 * Like every mutation on the board, an error is a value and not an exception: an unknown
 * kind, a rectangle or point that is not finite, an unknown colour name or a stale id all
 * return "no change" (`null`, or `false`) without opening a transaction, so a rejected
 * gesture writes nothing and syncs nothing.
 */
import * as Y from 'yjs';

import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config';
import { highestZ, LOCAL_ORIGIN, OBJECTS_KEY, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { isFiniteNumber } from '../util';

/** The string this object writes to `type`. */
export const SHAPE_TYPE = 'shape';

export { SHAPE_KINDS };
export type { ShapeKind, FillColor, StrokeColor };

/** An immutable view of one shape, as React renders it. */
export interface ShapeSnapshot extends ObjectSnapshot {
  readonly type: 'shape';
  readonly kind: ShapeKind;
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  readonly label: string;
  readonly createdBy: string;
}

/** Is this a shape kind the board can draw? */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** Is this a fill name in the palette (`shape.style`)? */
export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

/** Is this an outline name in the palette (`shape.style`)? */
export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

/** A rectangle whose every number is finite. */
function finiteRect(rect: Rect): boolean {
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

/** The default square, centred on `at`, that a click or a too-small drag becomes. */
function defaultSquare(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

/**
 * The rectangle a shape will actually occupy, from what was dragged.
 *
 * - no rectangle, or a drag narrower or shorter than `SHAPE_MIN_SIZE_WORLD`: the standard
 *   square centred on the click (`shape.create_click`) — a shape of exactly the minimum in
 *   both directions is kept, so the boundary is "below" not "at or below" (TC-02, TC-03).
 * - `square` (Shift held): both sides become the larger of the two, the top-left corner
 *   held (`shape.constrain`).
 */
function resolveRect(rect: Rect | null, at: Point, square: boolean): Rect {
  if (rect === null || !finiteRect(rect)) return defaultSquare(at);
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    return defaultSquare(at);
  }
  if (!square) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const side = Math.max(rect.width, rect.height);
  return { x: rect.x, y: rect.y, width: side, height: side };
}

/**
 * Put a shape on the board (`shape.create_drag`, `shape.create_click`).
 *
 * `rect` is the world rectangle a drag covered, or `null` for a click; `at` is the click
 * point, used to centre a standard shape; `square` is whether Shift was held. The new
 * shape lands on top of everything, owned by whoever asked.
 *
 * Returns the id, or `null` when the kind is unknown or a number is not finite — without
 * opening a transaction, so nothing is synced or undone for a shape that was never made
 * (`shape.model` error path, TC-06).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!a.at || !isFiniteNumber(a.at.x) || !isFiniteNumber(a.at.y)) return null;
  if (a.rect !== null && !finiteRect(a.rect)) return null;

  const box = resolveRect(a.rect, a.at, a.square === true);
  const id = crypto.randomUUID();
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', SHAPE_TYPE);
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('kind', a.kind);
    map.set('fill', DEFAULT_SHAPE_FILL);
    map.set('stroke', DEFAULT_SHAPE_STROKE);
    map.set('label', new Y.Text(''));
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', by);
    (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** The `Y.Map` of a shape, or `undefined` for a stale or foreign id. */
function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== SHAPE_TYPE) return undefined;
  return map;
}

/**
 * Change a shape's fill or outline (`shape.style`).
 *
 * Only the keys that are given are touched, so the label, size, position and stacking are
 * untouched and the selection is unchanged. An unknown colour name, or an id that is not a
 * shape, returns `false` with no transaction (TC-05).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const map = shapeMap(doc, id);
  if (!map) return false;
  const hasFill = style.fill !== undefined;
  const hasStroke = style.stroke !== undefined;
  if (!hasFill && !hasStroke) return true; // nothing asked for: the shape is already right
  if (hasFill && !isFillColor(style.fill)) return false;
  if (hasStroke && !isStrokeColor(style.stroke)) return false;

  doc.transact(() => {
    if (hasFill) map.set('fill', style.fill);
    if (hasStroke) map.set('stroke', style.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's `Y.Text` label, or `undefined` when there is no such shape. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = shapeMap(doc, id);
  if (!map) return undefined;
  const label = map.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** A stored size, or the fallback when it is missing, not a number or not positive. */
function storedPositive(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

/**
 * Read one `objects` entry as a `ShapeSnapshot`. `board-model` calls this from `readObject`.
 * It assumes the entry says `type: 'shape'`; a colour or kind from a newer build falls back
 * to the default so the shape still draws rather than disappearing.
 */
export function snapshotFrom(id: string, map: Y.Map<unknown>): ShapeSnapshot {
  const label = map.get('label');
  const kind = map.get('kind');
  const fill = map.get('fill');
  const stroke = map.get('stroke');
  const createdAt = map.get('createdAt');
  return {
    id,
    type: SHAPE_TYPE,
    x: Number(map.get('x')),
    y: Number(map.get('y')),
    width: storedPositive(map.get('width'), SHAPE_DEFAULT_SIZE_WORLD),
    height: storedPositive(map.get('height'), SHAPE_DEFAULT_SIZE_WORLD),
    z: Number(map.get('z')),
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
    createdBy: String(map.get('createdBy') ?? ''),
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}
