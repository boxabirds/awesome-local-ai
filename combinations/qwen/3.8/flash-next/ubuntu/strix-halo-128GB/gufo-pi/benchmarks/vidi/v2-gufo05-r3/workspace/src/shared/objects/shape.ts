/**
 * Shape object model (story 10).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *     kind: ShapeKind,           // 'rect' | 'ellipse' | 'diamond'
 *     fill: FillColor,           // key of SHAPE_FILL_COLORS ('none' = no fill)
 *     stroke: StrokeColor,       // key of SHAPE_STROKE_COLORS
 *     label: Y.Text              // centred inside the shape
 *   }
 *
 * Rules inherited from `board-model.ts`: every successful mutation is exactly
 * one `LOCAL_ORIGIN` transaction, and invalid input is rejected *before* a
 * transaction opens so nothing reaches the wire.
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
import { LOCAL_ORIGIN, type ShapeObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export type { ShapeKind };

/**
 * What the renderer reads for one shape.
 *
 * The declaration lives in `board-model.ts` (it is part of the document's read
 * model); this is the name the story's contract uses.
 */
export type ShapeSnap = ShapeObjectSnapshot;

/** Long name kept for call sites that spell the snapshot out. */
export type ShapeSnapshot = ShapeSnap;

export interface CreateShapeArgs {
  /** The kind drawn by the Shape tool's menu. */
  kind: ShapeKind;
  /** The dragged rectangle in world units, or `null` for a click. */
  rect: Rect | null;
  /** The press point in world units: the centre of a clicked shape. */
  at: Point;
  /** Shift held during the drag: width and height become equal. */
  square?: boolean;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Is this one of the three kinds the Shape tool offers? */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** Is this a fill key of {@link SHAPE_FILL_COLORS}? */
export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

/** Is this an outline key of {@link SHAPE_STROKE_COLORS}? */
export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

/**
 * The rectangle a new shape gets.
 *
 * - no rectangle, or a drag narrower or shorter than `SHAPE_MIN_SIZE_WORLD` in
 *   either direction, is a *click*: a standard `SHAPE_DEFAULT_SIZE_WORLD` shape,
 *   centred on the press point.
 * - a drag of exactly the minimum size is a real drag and is kept as drawn.
 * - Shift (`square`) makes both sides the larger dragged dimension, anchored at
 *   the corner the pointer started on, which is where `at` points.
 */
export function shapeBox(
  rect: Rect | null,
  at: Point,
  square = false,
): Rect {
  if (
    !rect ||
    rect.width < SHAPE_MIN_SIZE_WORLD ||
    rect.height < SHAPE_MIN_SIZE_WORLD
  ) {
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    return { x: at.x - half, y: at.y - half, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
  }
  if (!square) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const side = Math.max(rect.width, rect.height);
  // The press point is the drag's origin: keep the corner of the dragged box
  // that touches it, so a drag up-and-left grows up-and-left.
  const x = at.x >= rect.x + rect.width ? rect.x + rect.width - side : rect.x;
  const y = at.y >= rect.y + rect.height ? rect.y + rect.height - side : rect.y;
  return { x, y, width: side, height: side };
}

/**
 * Add a shape.
 *
 * `rect` is the dragged area in world units, or `null` for a click, in which
 * case (and for a drag below the minimum size) a standard-size shape lands
 * centred on `at`. Returns the new id, or `null` — without opening a
 * transaction — for an unknown kind or a non-finite rectangle or point.
 */
export function createShape(
  doc: Y.Doc,
  { kind, rect, at, square }: CreateShapeArgs,
  by: string,
): string | null {
  if (!isShapeKind(kind)) return null;
  if (!at || !finite(at.x) || !finite(at.y)) return null;
  if (
    rect !== null &&
    (!finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height))
  ) {
    return null;
  }

  const box = shapeBox(rect, at, square === true);
  let id: string | null = null;
  doc.transact(() => {
    const objects = objectsMap(doc);
    id = crypto.randomUUID();
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('kind', kind);
    shape.set('x', box.x);
    shape.set('y', box.y);
    shape.set('width', box.width);
    shape.set('height', box.height);
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text());
    shape.set('z', maxZ(objects) + 1);
    shape.set('createdAt', Date.now());
    shape.set('createdBy', by);
    objects.set(id, shape);
  }, LOCAL_ORIGIN);
  return id;
}

/** Highest `z` in the document (0 when it holds no objects). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

/**
 * Change a shape's fill and/or outline — and nothing else, which is what makes
 * restyling leave the label, size, position and selection alone.
 *
 * Unknown colour keys, a stale id and a colour the shape already has all return
 * `false` before a transaction opens.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const shape = objectsMap(doc).get(id);
  if (!shape || shape.get('type') !== 'shape') return false;

  const writes: [string, string][] = [];
  if (style.fill !== undefined) {
    if (!isFillColor(style.fill)) return false;
    if (shape.get('fill') !== style.fill) writes.push(['fill', style.fill]);
  }
  if (style.stroke !== undefined) {
    if (!isStrokeColor(style.stroke)) return false;
    if (shape.get('stroke') !== style.stroke) writes.push(['stroke', style.stroke]);
  }
  if (writes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of writes) shape.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's shared label, or `undefined` for a stale id or other type. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const shape = objectsMap(doc).get(id);
  if (!shape || shape.get('type') !== 'shape') return undefined;
  const label = shape.get('label');
  return label instanceof Y.Text ? label : undefined;
}


