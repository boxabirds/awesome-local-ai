/**
 * The shape object: schema and every mutation of it (story 10).
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *   kind: 'rect' | 'ellipse' | 'diamond',
 *   fill: FillColor, stroke: StrokeColor,   // palette keys, so re-tuning is one file
 *   label: Y.Text                            // centred inside the shape, shared live
 * }
 * ```
 *
 * Like every other object type, each accepted change is exactly one `LOCAL_ORIGIN` transaction and
 * every rejection - unknown kind, unknown colour name, non-finite numbers, stale id - is decided
 * before a transaction is opened, so a refusal produces no update for anybody to receive.
 *
 * Colours are stored as the palette *key*. A screen from an earlier build that does not know a key
 * still draws the shape, in the default style, rather than dropping it from the board.
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
  type StrokeColor,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../y-origin';

const OBJECTS_KEY = 'objects';

/** One of the three kinds a person can draw. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export type { FillColor, StrokeColor };

/**
 * One shape, as rendered by React.
 *
 * Spelled out rather than `extends ObjectSnapshot`, because `ObjectSnapshot` is the union of every
 * object type and an interface cannot extend a union.
 */
export interface ShapeSnapshot {
  readonly id: string;
  readonly type: 'shape';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly createdAt: number;
  readonly createdBy: string;
  readonly kind: ShapeKind;
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  /** The label's characters; the live text itself comes from `getShapeLabel`. */
  readonly label: string;
}

/** The short name the design uses for the same snapshot. */
export type ShapeSnap = ShapeSnapshot;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** The highest z on the board, or 0 when it holds nothing. */
function topZ(objects: Y.Map<Y.Map<unknown>>): number {
  let top = 0;
  for (const raw of objects.values()) {
    const z = raw.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/** True when `value` is one of the three kind keys. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** True when `value` names one of the fills (including `none`). */
export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

/** True when `value` names one of the outlines. */
export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

/** The `Y.Map` of a shape, or undefined for a stale id or another object type. */
export function getShapeRecord(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const raw = objectsOf(doc).get(id);
  if (!(raw instanceof Y.Map)) return undefined;
  return raw.get('type') === 'shape' ? raw : undefined;
}

/**
 * Reads one `Y.Map` into a `ShapeSnapshot`, or `undefined` when it cannot be drawn at all - a
 * shape whose position or size is not a number is skipped rather than crashing the board.
 */
export function readShapeObject(id: string, raw: Y.Map<unknown>): ShapeSnapshot | undefined {
  const x = raw.get('x');
  const y = raw.get('y');
  const width = raw.get('width');
  const height = raw.get('height');
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return undefined;
  const kind = raw.get('kind');
  if (!isShapeKind(kind)) return undefined;
  const z = raw.get('z');
  const label = raw.get('label');
  const createdAt = raw.get('createdAt');
  const createdBy = raw.get('createdBy');
  // a colour name this build does not know is drawn in the default style, not skipped
  const rawFill = raw.get('fill');
  const rawStroke = raw.get('stroke');
  const fill: FillColor = isFillColor(rawFill) ? rawFill : DEFAULT_SHAPE_FILL;
  const stroke: StrokeColor = isStrokeColor(rawStroke) ? rawStroke : DEFAULT_SHAPE_STROKE;
  return {
    id,
    type: 'shape',
    x,
    y,
    width,
    height,
    z: finite(z) ? z : 0,
    createdAt: finite(createdAt) ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    kind,
    fill,
    stroke,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}

/** The standard box, centred on the point that was clicked. */
function defaultBox(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

/**
 * The box a drag made, or `null` when the drag is refused.
 *
 * A `null` rect is a click and gets the standard size. So does a drag too small to be a shape -
 * `SHAPE_MIN_SIZE_WORLD` in either direction - which is also what a Shift drag of a couple of
 * pixels comes to. `square` replaces both sides with the larger dragged dimension before that
 * check, and keeps the corner the drag started from, which is the rect's top-left.
 */
function boxOfDrag(rect: Rect | null, at: Point, square: boolean): Rect | null {
  if (rect === null) return defaultBox(at);
  if (
    !finite(rect.x) ||
    !finite(rect.y) ||
    !finite(rect.width) ||
    !finite(rect.height)
  ) {
    return null;
  }
  let { x, y, width, height } = rect;
  if (square) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) return defaultBox(at);
  return { x, y, width, height };
}

/**
 * Creates a shape of `kind` and returns its id, or `null` when the request is refused.
 *
 * `rect` is the world rectangle that was dragged, `null` for a click; `at` is the point under the
 * pointer, which is where a standard-size shape is centred. `square` is the Shift key.
 */
export function createShape(
  doc: Y.Doc,
  args: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  const { kind, rect, at, square = false } = args ?? {};
  if (!isShapeKind(kind)) return null;
  if (!at || !finite(at.x) || !finite(at.y)) return null;
  const box = boxOfDrag(rect, at, square);
  if (!box) return null;

  const id = crypto.randomUUID();
  const who = typeof by === 'string' ? by : '';
  doc.transact(() => {
    const objects = objectsOf(doc);
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', box.x);
    shape.set('y', box.y);
    shape.set('width', box.width);
    shape.set('height', box.height);
    shape.set('kind', kind);
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text(''));
    shape.set('z', topZ(objects) + 1);
    shape.set('createdAt', Date.now());
    shape.set('createdBy', who);
    objects.set(id, shape);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Changes the fill and/or the outline, leaving position, size, kind and label alone.
 * False for an unknown colour name, a stale id, an object that is not a shape, or a style the
 * shape already has - all of them before any transaction is opened.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const style_ = style ?? {};
  const hasFill = style_.fill !== undefined;
  const hasStroke = style_.stroke !== undefined;
  if (!hasFill && !hasStroke) return false;
  if (hasFill && !isFillColor(style_.fill)) return false;
  if (hasStroke && !isStrokeColor(style_.stroke)) return false;

  const shape = getShapeRecord(doc, id);
  if (!shape) return false;
  const sameFill = !hasFill || shape.get('fill') === style_.fill;
  const sameStroke = !hasStroke || shape.get('stroke') === style_.stroke;
  if (sameFill && sameStroke) return false; // the style it already has: nothing to sync

  doc.transact(() => {
    if (hasFill) shape.set('fill', style_.fill as FillColor);
    if (hasStroke) shape.set('stroke', style_.stroke as StrokeColor);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's shared label, for editing. Undefined when the id is stale or not a shape. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = getShapeRecord(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
