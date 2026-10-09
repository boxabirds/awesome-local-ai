import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../config';
import {
  LOCAL_ORIGIN,
  newObjectId,
  topZ,
  type ObjectSnapshotBase,
} from '../board-model';
import type { Rect } from '../geometry';

/**
 * The `shape` object type (story 10): a rectangle, ellipse or diamond with a centred
 * label, drawn by dragging the Shape tool over the board or by clicking it once.
 *
 * Schema — the same entry of `objects` every other type has, plus:
 *
 *     kind: ShapeKind, fill: FillColor, stroke: StrokeColor, strokeWidth: number,
 *     label: Y.Text, createdBy, createdAt
 *
 * A shape is an ordinary box: `x`, `y`, `width` and `height` are stored, so story 7's
 * move and resize code works on it without knowing shapes exist. Only the label is a
 * shared `Y.Text`, so two people can label one shape at once the way they already type
 * into one sticky note.
 *
 * Nothing here draws: `src/client/objects/ShapeObject.tsx` turns these fields into SVG.
 * A stale id never throws — the setters return false and `createShape` returns null.
 */

/** The object type this module owns. */
export const SHAPE_TYPE = 'shape';

/** The three kinds this board draws, in the order the Shape menu lists them. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A fill or an outline is one of the settings' keys, and that is the type that says so. */
export type FillColor = ShapeFillColor;
export type StrokeColor = ShapeStrokeColor;

/** What the label editor says when the shape has no label yet. */
export const SHAPE_LABEL_PLACEHOLDER = 'Label';

/** A shape as one read of the document saw it. */
export interface ShapeSnapshot extends ObjectSnapshotBase {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  /** The outline's width in board units, so it thickens with the board like everything else. */
  strokeWidth: number;
  label: string;
  /** The device that drew it (story 6 hands out the id; today it is this tab's). */
  createdBy: string;
  createdAt: number;
  known: true;
}

/** Is this one of ours? `type` is any string once a document has been synced. */
export function isShapeSnapshot(object: { type: string } | undefined): object is ShapeSnapshot {
  return object?.type === SHAPE_TYPE;
}

/** Every kind the Shape menu offers, in the order it offers them. */
export const SHAPE_KIND_KEYS: readonly ShapeKind[] = SHAPE_KINDS;

/**
 * The kind a board starts on, which is the first one the menu lists (PRD: "A small menu next
 * to the button shows Rectangle (selected), Ellipse, Diamond"). Not a product setting: it is
 * the order of the menu, and the menu is the UI.
 */
export const DEFAULT_SHAPE_KIND: ShapeKind = SHAPE_KINDS[0];

/** Runtime validation: a synced document can hold anything in place of a kind. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** Runtime validation of a fill name, including `none`. */
export function isShapeFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

/** Runtime validation of an outline name. */
export function isShapeStrokeColor(value: unknown): value is StrokeColor {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value)
  );
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

function kindOf(item: YObject): ShapeKind {
  return isShapeKind(item.get('kind')) ? (item.get('kind') as ShapeKind) : 'rect';
}

function fillOf(item: YObject): FillColor {
  return isShapeFillColor(item.get('fill')) ? (item.get('fill') as FillColor) : DEFAULT_SHAPE_FILL;
}

function strokeOf(item: YObject): StrokeColor {
  return isShapeStrokeColor(item.get('stroke'))
    ? (item.get('stroke') as StrokeColor)
    : DEFAULT_SHAPE_STROKE;
}

function labelOf(item: YObject): Y.Text | undefined {
  const label = item.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/**
 * A shape read out of the document, or undefined when `id` is gone or is another type.
 * `objectSnapshots` uses the same reading, so the board's list and this function never
 * disagree about what a shape holds.
 */
export function readShape(doc: Y.Doc, id: string): ShapeSnapshot | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== SHAPE_TYPE) return undefined;
  return shapeSnapshotOf(id, item);
}

/** The shared reading `board-model` uses when it walks the whole objects map. */
export function readShapeObject(id: string, item: YObject): ShapeSnapshot | undefined {
  if (item.get('type') !== SHAPE_TYPE) return undefined;
  return shapeSnapshotOf(id, item);
}

function shapeSnapshotOf(id: string, item: YObject): ShapeSnapshot {
  const label = labelOf(item);
  const createdBy = item.get('createdBy');
  return {
    id,
    type: SHAPE_TYPE,
    x: numberOf(item, 'x', 0),
    y: numberOf(item, 'y', 0),
    z: numberOf(item, 'z', 0),
    width: Math.max(numberOf(item, 'width', SHAPE_DEFAULT_SIZE_WORLD), SHAPE_MIN_SIZE_WORLD),
    height: Math.max(numberOf(item, 'height', SHAPE_DEFAULT_SIZE_WORLD), SHAPE_MIN_SIZE_WORLD),
    known: true,
    kind: kindOf(item),
    fill: fillOf(item),
    stroke: strokeOf(item),
    strokeWidth: Math.max(numberOf(item, 'strokeWidth', SHAPE_STROKE_WIDTH_WORLD), 0),
    label: label ? label.toString() : '',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: numberOf(item, 'createdAt', 0),
  };
}

/**
 * The shape's label as a shared `Y.Text`, so story 2's editor can bind to it and type
 * into it. Undefined for a stale id, or for an object that is not a shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== SHAPE_TYPE) return undefined;
  return labelOf(item);
}

/** What the caller asked for, and whether it is worth opening a transaction for. */
export interface CreateShapeOptions {
  /** The kind that was chosen in the Shape menu. */
  kind: ShapeKind;
  /** The box that was dragged, or null when the tool was clicked without dragging. */
  rect: Rect | null;
  /** Where the pointer went down, in board units: the centre of a clicked shape. */
  at: { x: number; y: number };
  /** Shift was held: the box becomes a square on its longer side. */
  square: boolean;
}

/**
 * The box a shape ends up with, given what was dragged (design: shape.create_click,
 * shape.create_drag, shape.shift_square).
 *
 * A click (`rect: null`) or a drag smaller than `SHAPE_MIN_SIZE_WORLD` in either
 * direction is a click: the standard shape, `SHAPE_DEFAULT_SIZE_WORLD` on a side,
 * centred on `at`. A drag of exactly `SHAPE_MIN_SIZE_WORLD` is a shape — the boundary
 * is inclusive. `square` puts both sides at the longer side, anchored at the top-left
 * the drag reached, so a 200 × 120 drag becomes a 200 × 200 square.
 */
export function shapeRectFor(
  options: Pick<CreateShapeOptions, 'rect' | 'at' | 'square'>,
): Rect | null {
  const { rect, at, square } = options;
  if (!isFinitePoint(at)) return null;
  // A box that was dragged but holds no finite numbers is not a click, it is a bug, and
  // making a standard shape out of it would hide the bug (TC-06).
  if (rect !== null && !isFiniteRect(rect)) return null;
  if (
    rect === null ||
    rect.width < SHAPE_MIN_SIZE_WORLD ||
    rect.height < SHAPE_MIN_SIZE_WORLD
  ) {
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    return {
      x: at.x - half,
      y: at.y - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (!square) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const side = Math.max(rect.width, rect.height);
  return { x: rect.x, y: rect.y, width: side, height: side };
}

/**
 * Creates a shape. Returns its id, or null when the kind is not one of the three, the
 * point is not finite, or the object would have no finite box — in every one of those
 * cases the document is not touched, not even by an empty transaction.
 *
 * The new shape is on top of everything (`z = topZ(doc) + 1`) and empty-labelled.
 */
export function createShape(
  doc: Y.Doc,
  options: CreateShapeOptions,
  createdBy: string,
): string | null {
  if (!isShapeKind(options.kind)) return null;
  const rect = shapeRectFor(options);
  if (!rect) return null;
  const id = newObjectId();
  doc.transact(() => {
    const item = new Y.Map<unknown>();
    item.set('type', SHAPE_TYPE);
    item.set('kind', options.kind);
    item.set('x', rect.x);
    item.set('y', rect.y);
    item.set('width', rect.width);
    item.set('height', rect.height);
    item.set('fill', DEFAULT_SHAPE_FILL);
    item.set('stroke', DEFAULT_SHAPE_STROKE);
    item.set('strokeWidth', SHAPE_STROKE_WIDTH_WORLD);
    item.set('label', new Y.Text(''));
    item.set('z', topZ(doc) + 1);
    item.set('createdAt', Date.now());
    item.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    objectsOf(doc).set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Sets a shape's fill and outline (design: shape.style). Only the colours named in the
 * settings are accepted: false, and nothing written, for a stale id, an object that is
 * not a shape, a colour the toolbar does not offer, or colours the shape already has.
 * Everything else about the shape — its label, its box, its place in the stack — stays.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: FillColor; stroke?: StrokeColor },
): boolean {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== SHAPE_TYPE) return false;
  const writes: [key: string, value: string][] = [];
  if (style.fill !== undefined) {
    if (!isShapeFillColor(style.fill)) return false;
    if (fillOf(item) !== style.fill) writes.push(['fill', style.fill]);
  }
  if (style.stroke !== undefined) {
    if (!isShapeStrokeColor(style.stroke)) return false;
    if (strokeOf(item) !== style.stroke) writes.push(['stroke', style.stroke]);
  }
  if (writes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of writes) item.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

function isFinitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isFiniteRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}
