// Story 10: the shape object model (anchor: shapes.model).
//
// A shape is a rectangle, ellipse or diamond with a fill colour, an outline
// colour and an optional Y.Text label. The label lives in the shared document
// so it is collaborative and undoable like every other board text; the rest
// of the geometry is plain Y.Map fields.
//
// All mutations follow the story 7/9 conventions: invalid input is rejected
// with null/false and NO transaction; a successful mutation is exactly one
// LOCAL_ORIGIN transaction; missing ids are rejected, never silently reused.

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
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, objectMap, type ObjectSnapshot } from '../board-model';

/** Immutable view of one shape, as rendered by React. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  /** Epoch ms. */
  createdAt: number;
  createdBy: string;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && value in SHAPE_FILL_COLORS;
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && value in SHAPE_STROKE_COLORS;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** z = maxZ + 1 (1 when the board is empty). */
function nextZ(map: Y.Map<Y.Map<unknown>>): number {
  let z = 1;
  for (const obj of map.values()) {
    const existing = asNumber(obj.get('z'), 0);
    if (existing >= z) z = existing + 1;
  }
  return z;
}

/**
 * A square with the same area anchor as the drag: the side is the larger of
 * the two drawn dimensions, and the square is anchored at the rect corner
 * nearest the drag origin (shapes.size).
 */
export function squareRect(rect: Rect, at: Point): Rect {
  const side = Math.max(rect.width, rect.height);
  const x =
    Math.abs(at.x - (rect.x + rect.width)) <= Math.abs(at.x - rect.x)
      ? rect.x + rect.width - side
      : rect.x;
  const y =
    Math.abs(at.y - (rect.y + rect.height)) <= Math.abs(at.y - rect.y)
      ? rect.y + rect.height - side
      : rect.y;
  return { x, y, width: side, height: side };
}

function defaultRect(at: Point): Rect {
  const s = SHAPE_DEFAULT_SIZE_WORLD;
  return { x: at.x - s / 2, y: at.y - s / 2, width: s, height: s };
}

function resolveShapeRect(input: ShapeCreateInput): Rect {
  const { rect, at } = input;
  if (rect === null) return defaultRect(at);
  // A drag smaller than the minimum in either axis counts as a click.
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    return defaultRect(at);
  }
  if (input.square) return squareRect(rect, at);
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export interface ShapeCreateInput {
  kind: ShapeKind;
  /** The drawn rect (drag), or null for a pure click. */
  rect: Rect | null;
  /** The drag origin / click point (world units). */
  at: Point;
  /** Shift held during the drag: the shape is drawn as a square. */
  square: boolean;
}

/**
 * Create a shape from a click or drag (shapes.size) and return its new id.
 *
 * - click (or a drag smaller than {@link SHAPE_MIN_SIZE_WORLD} in either
 *   axis): the default 160x160 square centred on the click point;
 * - drag: exactly the drawn rect, unless `square`, which anchors a square of
 *   the larger dimension at the drag origin;
 * - invalid kind/geometry: null, no transaction.
 */
export function createShape(doc: Y.Doc, input: ShapeCreateInput, by: string): string | null {
  if (!isShapeKind(input.kind)) return null;
  if (!isFinitePoint(input.at)) return null;
  // A provided rect must be finite (a null rect is a plain click).
  if (input.rect !== null && !isFiniteRect(input.rect)) return null;

  const rect = resolveShapeRect(input);
  const id = crypto.randomUUID();
  const label = new Y.Text();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'shape');
  obj.set('kind', input.kind);
  obj.set('fill', DEFAULT_SHAPE_FILL);
  obj.set('stroke', DEFAULT_SHAPE_STROKE);
  obj.set('x', rect.x);
  obj.set('y', rect.y);
  obj.set('width', rect.width);
  obj.set('height', rect.height);
  obj.set('label', label);
  obj.set('z', nextZ(objectMap(doc)));
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  doc.transact(
    () => {
      objectMap(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * Change a shape's named fill and/or outline colour (shape.style). Returns
 * false (no update) for unknown ids, non-shapes, unknown colour names, or
 * when nothing actually changes.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: FillColor; stroke?: StrokeColor },
): boolean {
  const hasFill = style.fill !== undefined;
  const hasStroke = style.stroke !== undefined;
  if (!hasFill && !hasStroke) return false;
  if (hasFill && !isFillColor(style.fill)) return false;
  if (hasStroke && !isStrokeColor(style.stroke)) return false;

  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'shape') return false;
  const fillChanged = hasFill && obj.get('fill') !== style.fill;
  const strokeChanged = hasStroke && obj.get('stroke') !== style.stroke;
  if (!fillChanged && !strokeChanged) return false; // no-op: no update

  doc.transact(
    () => {
      if (fillChanged) obj.set('fill', style.fill);
      if (strokeChanged) obj.set('stroke', style.stroke);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The live Y.Text of a shape's label, or undefined for unknown ids / other types. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'shape') return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}
