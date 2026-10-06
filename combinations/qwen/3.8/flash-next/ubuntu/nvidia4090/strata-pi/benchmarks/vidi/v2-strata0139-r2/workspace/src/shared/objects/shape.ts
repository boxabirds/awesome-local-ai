import * as Y from "yjs";
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from "../config";
import {
  LOCAL_ORIGIN,
  snapshot,
  type ObjectSnapshot,
} from "../board-model";
import type { Point, Rect } from "../geometry";

/**
 * Shape objects (`shape.model`) — story 10.
 *
 * A shape is a board object with a kind (rectangle, ellipse, diamond), a fill,
 * an outline colour and a label. It lives in the same `objects` map sticky notes
 * and text objects live in, with the same common keys (`x, y, width, height, z,
 * createdAt, createdBy`), so selecting, moving, resizing, deleting and undoing
 * it is the shared story 7 / story 8 code and nothing here re-implements it.
 *
 * The label is a `Y.Text`, like every other piece of board text: two people
 * typing into the same label merge (story 3) instead of overwriting.
 *
 * Rejected calls return `null`/`false` **before** a transaction is opened, so an
 * invalid gesture never puts an update on the wire.
 */

const SHAPE_TYPE = "shape";

export interface ShapeSnap extends ObjectSnapshot {
  readonly type: "shape";
  readonly kind: ShapeKind;
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  readonly label: string;
}

export interface CreateShapeArgs {
  /** One of `SHAPE_KINDS`. Anything else is refused. */
  kind: ShapeKind;
  /** The world rectangle that was dragged, or `null` for a plain click. */
  rect: Rect | null;
  /** The point the drag started from, or the point that was clicked. */
  at: Point;
  /** Shift held during the drag: width and height become equal (`shape.constrain`). */
  square?: boolean;
  /**
   * The style the Shape tool is currently set to (`shape.style`). A name this
   * build does not know falls back to the default colour rather than refusing
   * the shape: the style is a preference, not an input the board must trust.
   */
  fill?: FillColor;
  stroke?: StrokeColor;
}

/** Names this build accepts for a fill, including "no fill", and for an outline. */
export { SHAPE_FILL_NAMES, SHAPE_STROKE_NAMES } from "../config";

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === "string" && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

/**
 * `createShape(doc, { kind, rect, at, square }, by) -> id | null`
 *
 * - a dragged rectangle becomes a shape of exactly that size (`shape.create_drag`);
 * - a click (`rect: null`) or a drag under `SHAPE_MIN_SIZE_WORLD` in either
 *   direction becomes a standard `SHAPE_DEFAULT_SIZE_WORLD` shape centred on the
 *   point (`shape.create_click`); a drag of exactly the minimum is kept as drawn;
 * - `square` makes both sides the larger dragged side, keeping the corner the
 *   drag was pulled from (`shape.constrain`).
 *
 * The new shape is above everything on the board (`z = maxZ + 1`).
 */
export function createShape(doc: Y.Doc, args: CreateShapeArgs, by?: string): string | null {
  if (!args) return null;
  if (!isShapeKind(args.kind)) return null;
  if (!isPoint(args.at)) return null;

  const dragged = args.rect === null || args.rect === undefined ? null : args.rect;
  if (dragged !== null && !isUsableRect(dragged)) return null;

  const box = boxFor(dragged, args.at, args.square === true);

  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const id = newId();
  const z = maxZ(objects) + 1;
  const createdAt = Date.now();
  const label = new Y.Text();

  doc.transact(() => {
    const shape = new Y.Map<unknown>();
    shape.set("type", SHAPE_TYPE);
    shape.set("kind", args.kind);
    shape.set("x", box.x);
    shape.set("y", box.y);
    shape.set("width", box.width);
    shape.set("height", box.height);
    shape.set("fill", isFillColor(args.fill) ? args.fill : DEFAULT_SHAPE_FILL);
    shape.set("stroke", isStrokeColor(args.stroke) ? args.stroke : DEFAULT_SHAPE_STROKE);
    shape.set("label", label);
    shape.set("z", z);
    shape.set("createdAt", createdAt);
    if (typeof by === "string" && by.length > 0) shape.set("createdBy", by);
    objects.set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * `setShapeStyle(doc, id, { fill?, stroke? }) -> applied`
 *
 * Changes only the colour keys it was given: the label, the size, the position,
 * the stacking and the selection are never touched (`shape.style`). An unknown
 * colour name, a stale id, a shape already that colour or an empty request all
 * return `false` without opening a transaction.
 */
export function setShapeStyle(doc: Y.Doc, id: string, style: { fill?: string; stroke?: string }): boolean {
  const shape = shapeEntry(doc, id);
  if (!shape) return false;

  const fill = style?.fill;
  const stroke = style?.stroke;
  if (fill === undefined && stroke === undefined) return false;
  if (fill !== undefined && !isFillColor(fill)) return false;
  if (stroke !== undefined && !isStrokeColor(stroke)) return false;
  if (fill !== undefined && shape.get("fill") === fill) return false;
  if (stroke !== undefined && shape.get("stroke") === stroke) return false;

  doc.transact(() => {
    if (fill !== undefined) shape.set("fill", fill);
    if (stroke !== undefined) shape.set("stroke", stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's shared label, for the editor to diff into (`shape.label`). */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeEntry(doc, id)?.get("label");
  return label instanceof Y.Text ? label : undefined;
}

/** The board's shapes, z-ordered, as snapshots. */
export function shapeSnapshot(doc: Y.Doc): readonly ShapeSnap[] {
  return snapshot(doc).filter((object): object is ShapeSnap => object.type === SHAPE_TYPE);
}

// ---- internals ------------------------------------------------------------

/** The box the model gives a new shape, from what was dragged. */
function boxFor(dragged: Rect | null, at: Point, square: boolean): Rect {
  if (dragged === null || dragged.width < SHAPE_MIN_SIZE_WORLD || dragged.height < SHAPE_MIN_SIZE_WORLD) {
    // A click, or a drag too small to be a shape: the standard size, centred.
    return {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }

  if (!square) return { x: dragged.x, y: dragged.y, width: dragged.width, height: dragged.height };

  // Shift: the larger dragged side on both axes, anchored on the corner the
  // drag started from, so the shape still reaches where the pointer went.
  const side = Math.max(dragged.width, dragged.height);
  const right = at.x > dragged.x + dragged.width / 2;
  const bottom = at.y > dragged.y + dragged.height / 2;
  return {
    x: right ? dragged.x + dragged.width - side : dragged.x,
    y: bottom ? dragged.y + dragged.height - side : dragged.y,
    width: side,
    height: side,
  };
}

function shapeEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const entry = doc.getMap<Y.Map<unknown>>("objects").get(id);
  if (!(entry instanceof Y.Map)) return undefined;
  return entry.get("type") === SHAPE_TYPE ? entry : undefined;
}

function isPoint(value: Point | undefined): value is Point {
  return !!value && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

/** Finite, positive, inside the board's size limits. */
function isUsableRect(rect: Rect): boolean {
  if (!isFiniteNumber(rect.x) || !isFiniteNumber(rect.y)) return false;
  if (!isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.width <= MAX_OBJECT_SIZE_WORLD && rect.height <= MAX_OBJECT_SIZE_WORLD;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const value of objects.values()) {
    if (!(value instanceof Y.Map)) continue;
    const z = value.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
