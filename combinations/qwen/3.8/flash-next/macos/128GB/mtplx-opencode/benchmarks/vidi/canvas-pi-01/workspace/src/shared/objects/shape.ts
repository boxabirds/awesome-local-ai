/**
 * Story 10 · task 8 — the shape object model (design "Shape model").
 *
 * The framework-free half of "draw shapes and connect them": every mutation of a
 * `shape` object lives here, written against a real `Y.Doc` like the sticky and
 * text models. A `shape` record is the generic object schema plus four fields of
 * its own — `kind`, `fill`, `stroke` and `label` (a `Y.Text`, so a label edits,
 * syncs and undoes exactly like story 2's note text).
 *
 * A shape stores **no** attachment information: an arrow that points at it lives
 * in the `connector` module, which reads this record's rectangle. Selection,
 * move, resize, delete and undo come from stories 7 and 8 unchanged.
 *
 * Nothing here throws for user-driven input. An unknown kind, a non-finite
 * rectangle or a stale id returns `null`/`false` and opens **no** transaction.
 */
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type ShapeFill,
  type ShapeStroke,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, finite, newId, objectsOf, recordIsType, topZ } from '../doc';

/** The registry key for a shape. */
export const SHAPE_TYPE = 'shape';

/** What shape to draw: the three kinds this build knows. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** An immutable shape snapshot, as `snapshot()` reports it. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: ShapeFill;
  stroke: ShapeStroke;
  label: string;
}

/** Everything the Shape tool knows when it releases the pointer. */
export interface CreateShapeArgs {
  /** The kind selected in the Shape menu. */
  kind: ShapeKind;
  /**
   * The dragged rectangle in world units, or `null` for a plain click (and for
   * a drag too small to be a deliberate size).
   */
  rect: Rect | null;
  /** The click point, used to centre a default-size shape. */
  at: Point;
  /** Shift: make the shape square, sized by the longer dragged edge. */
  square?: boolean;
}

/** True when the record is a shape. */
export function isShapeRecord(record: Y.Map<unknown> | undefined): record is Y.Map<unknown> {
  return recordIsType(record, SHAPE_TYPE);
}

/** Is `kind` one of the shapes this build draws? */
export function isShapeKind(kind: unknown): kind is ShapeKind {
  return typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind);
}

/** Is `fill` one of the offered fills (`none` included)? */
export function isShapeFill(fill: unknown): fill is ShapeFill {
  return typeof fill === 'string' &&
    Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, fill);
}

/** Is `stroke` one of the offered outline colours? */
export function isShapeStroke(stroke: unknown): stroke is ShapeStroke {
  return typeof stroke === 'string' &&
    Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, stroke);
}

/**
 * The rectangle a shape is actually created with.
 *
 * A drag of at least {@link SHAPE_MIN_SIZE_WORLD} on both axes keeps its size
 * (TC-03: exactly 20×20 is a shape, not a mis-click). Anything smaller — and a
 * plain click, which has no rectangle at all — becomes the default
 * {@link SHAPE_DEFAULT_SIZE_WORLD} box centred on the click point. With Shift the
 * shape is square: the longer dragged edge sets both sides, anchored at the
 * drag's own top-left so the preview and the result agree.
 */
export function shapeRect(
  rect: Rect | null,
  at: Point,
  square = false,
): Rect {
  const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
  if (rect === null || !finite(rect.x, rect.y, rect.width, rect.height)) {
    return {
      x: at.x - half,
      y: at.y - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  let { x, y, width, height } = rect;
  if (square) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  // A drag below the minimum on *either* axis is treated as a click.
  if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) {
    return {
      x: at.x - half,
      y: at.y - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  return { x, y, width, height };
}

/**
 * Create a shape. `a.rect` is the dragged rectangle (world units) or `null` for
 * a click; `a.at` is the click point; `a.square` applies Shift.
 *
 * Returns the new id, or `null` for an unknown kind or a non-finite geometry —
 * in both cases no transaction is opened. A success is exactly one
 * `LOCAL_ORIGIN` transaction holding the new record.
 */
export function createShape(
  doc: Y.Doc,
  a: CreateShapeArgs,
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!finite(a.at.x, a.at.y)) return null;
  if (a.rect !== null && !finite(a.rect.x, a.rect.y, a.rect.width, a.rect.height)) return null;

  const rect = shapeRect(a.rect, a.at, a.square === true);
  const id = newId();
  const top = topZ(doc) + 1;
  const fill = DEFAULT_SHAPE_FILL;
  const stroke = DEFAULT_SHAPE_STROKE;

  doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set('type', SHAPE_TYPE);
    record.set('kind', a.kind);
    record.set('x', rect.x);
    record.set('y', rect.y);
    record.set('width', rect.width);
    record.set('height', rect.height);
    record.set('fill', fill);
    record.set('stroke', stroke);
    record.set('label', new Y.Text(''));
    record.set('z', top);
    record.set('createdAt', Date.now());
    record.set('createdBy', by);
    objectsOf(doc).set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a shape's fill and/or outline. Unknown colour tokens and a stale (or
 * non-shape) id return `false` without a transaction, so a mis-click or a click
 * on a vanished shape never produces a sync message. A change to either key is
 * one transaction, and only the colour keys are touched.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const record = objectsOf(doc).get(id);
  if (!isShapeRecord(record)) return false;

  const writes: Array<[string, string]> = [];
  if (style.fill !== undefined) {
    if (!isShapeFill(style.fill)) return false;
    if (record.get('fill') !== style.fill) writes.push(['fill', style.fill]);
  }
  if (style.stroke !== undefined) {
    if (!isShapeStroke(style.stroke)) return false;
    if (record.get('stroke') !== style.stroke) writes.push(['stroke', style.stroke]);
  }
  if (writes.length === 0) return false;

  doc.transact(() => {
    for (const [key, value] of writes) record.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shape's `Y.Text` label, or `undefined` for a stale / non-shape id — the
 * handle story 2's editor needs, clamped to {@link SHAPE_LABEL_MAX_CHARS}.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const record = objectsOf(doc).get(id);
  if (!isShapeRecord(record)) return undefined;
  const label = record.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** The label's current text (empty string when there is none). */
export function shapeLabelText(doc: Y.Doc, id: string): string {
  return getShapeLabel(doc, id)?.toString() ?? '';
}

/** The label limit this build applies, exported so the editor and tests agree. */
export const SHAPE_TEXT_LIMIT = SHAPE_LABEL_MAX_CHARS;
