// The shape object's part of the board document (`shape.model`).
//
// Story 10's first kind of object, added the way story 9 added text: this file tells
// `board-model` that a `shape` exists, how small it may go and how it is read, and
// then every generic operation — select, move, resize, nudge, delete, undo, share —
// is the one story 7 wrote and story 8 made undoable, with nothing shape-specific
// added to them.
//
// Schema of one shape (design.md, "Document schema addition"):
//   objects/<id>: Y.Map {
//     type: 'shape', kind: ShapeKind, x, y, width, height,
//     fill: ShapeFill, stroke: ShapeStroke, label: Y.Text, z,
//     createdAt, createdBy
//   }
//
// The label is a `Y.Text` like a note's text, so two people typing in one shape's
// label merge instead of overwriting each other; the limit is its own
// (`shape.label_max_chars`) because a label is a caption, not a paragraph.
//
// Like the rest of `src/shared`, this file may not touch the DOM.
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type ShapeFill,
  type ShapeKind,
  type ShapeStroke,
} from '../config';
import {
  LOCAL_ORIGIN,
  registerObjectTypeModel,
  registerObjectTypeReader,
  type BoardObject,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';

/** A shape as the board reads it. */
export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  /** A shape always has a size: it is the rectangle the shape is drawn in. */
  width: number;
  height: number;
  fill: ShapeFill;
  stroke: ShapeStroke;
  /** The label's characters. The shared `Y.Text` comes from `getShapeLabel`. */
  label: string;
  /** Who made it. Story 6 (identity) is not built, so this is the local device id. */
  createdBy?: string;
  createdAt?: number;
}

/** The rectangle and style a new shape is asked for. */
export interface CreateShapeOptions {
  kind?: ShapeKind;
  /** The rectangle the person dragged, or null when they only clicked. */
  rect?: Rect | null;
  /** Where they let go / clicked: what a default-sized shape is centred on. */
  at?: Point | null;
  /** Shift was held: the result is a square, anchored at the drag's origin. */
  square?: boolean;
  createdBy?: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isKind = (value: unknown): value is ShapeKind =>
  (SHAPE_KINDS as readonly string[]).includes(value as string);

const isFill = (value: unknown): value is ShapeFill =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);

const isStroke = (value: unknown): value is ShapeStroke =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const isShape = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'shape';

/** The first kind is the one a shape is created as when nobody said. */
export const DEFAULT_SHAPE_KIND: ShapeKind = SHAPE_KINDS[0];

/** No shape is bigger than the one size every object shares. */
const clampSize = (value: number): number =>
  Math.min(Math.max(value, SHAPE_MIN_SIZE_WORLD), MAX_OBJECT_SIZE_WORLD);

/**
 * Tell the shared model that a `shape` object exists and how small it may go. The
 * client registry does this too; doing it here as well is what lets a unit test, or
 * the Worker, read a shape with no DOM and no React in sight.
 */
registerObjectTypeModel('shape', SHAPE_MIN_SIZE_WORLD);
// And how it is read: without this the generic snapshot would carry a shape's box and
// none of its kind, colours or label.
registerObjectTypeReader('shape', readShapeObject);

/** The size a shape that was clicked rather than dragged gets: square. */
export const defaultShapeSize = (): { width: number; height: number } => ({
  width: SHAPE_DEFAULT_SIZE_WORLD,
  height: SHAPE_DEFAULT_SIZE_WORLD,
});

/**
 * Draw a shape, in one local transaction, above every other object.
 *
 * Three cases, and they are the three ways a person can end a drag
 * (`shape.creation`):
 *
 * - a drag big enough to be a size → that rectangle (`rect`);
 * - `square` (Shift held) → the longer edge wins and the shape stays anchored at
 *   the rectangle's origin, which is where the pointer went down;
 * - a click, or a drag too small to be a size → `SHAPE_DEFAULT_SIZE` centred on
 *   `at`, because a shape made by a click is placed, not sized.
 *
 * Returns the new id, or null when the request is not a request: a kind nothing
 * draws, a rectangle with numbers missing from it, or nowhere on the board to put
 * it. Then nothing at all is written.
 */
export function createShape(
  doc: Y.Doc,
  options: CreateShapeOptions,
  by: string,
): string | null {
  const kind = options.kind ?? DEFAULT_SHAPE_KIND;
  if (!isKind(kind)) return null;

  const { rect, at } = options;
  if (rect !== null && rect !== undefined) {
    if (
      typeof rect !== 'object' ||
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height)
    ) {
      return null;
    }
  }
  const atPoint =
    at !== null && at !== undefined && isFiniteNumber(at.x) && isFiniteNumber(at.y)
      ? at
      : null;
  // A small drag states a place as much as a size; a rect is allowed to be that
  // place when no `at` came with it.
  const place: Point | null = atPoint ?? (rect ? { x: rect.x, y: rect.y } : null);
  if (place === null) return null;

  let box: Rect;
  if (
    rect === null ||
    rect === undefined ||
    rect.width < SHAPE_MIN_SIZE_WORLD ||
    rect.height < SHAPE_MIN_SIZE_WORLD
  ) {
    const size = defaultShapeSize();
    box = { x: place.x - size.width / 2, y: place.y - size.height / 2, ...size };
  } else if (options.square === true) {
    // A square is the longer edge on both axes, growing from the corner the drag
    // started at — 200x120 becomes 200x200, not 200x200 somewhere else.
    const side = clampSize(Math.max(rect.width, rect.height));
    box = { x: rect.x, y: rect.y, width: side, height: side };
  } else {
    box = {
      x: rect.x,
      y: rect.y,
      width: clampSize(rect.width),
      height: clampSize(rect.height),
    };
  }

  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    const z = value instanceof Y.Map ? value.get('z') : undefined;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', 'shape');
    object.set('kind', kind);
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('fill', DEFAULT_SHAPE_FILL);
    object.set('stroke', DEFAULT_SHAPE_STROKE);
    object.set('label', new Y.Text());
    object.set('z', maxZ + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', typeof by === 'string' ? by : '');
    objectsMap(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Paint a shape: either colour, or both at once, in one transaction so a single
 * undo step reverts what a person thinks of as one change.
 *
 * An unknown colour name, a missing object or an object that is not a shape all
 * return false without a transaction, and so does asking for the colours the shape
 * already has — writing what is already there is a change every collaborator has to
 * merge, and nobody asked for it. The position and size are never touched: repainting
 * a shape does not move it (`shape.styling`, TC-05).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const found = objectsMap(doc).get(id);
  if (!isShape(found)) return false;
  if (style.fill === undefined && style.stroke === undefined) return false;
  if (style.fill !== undefined && !isFill(style.fill)) return false;
  if (style.stroke !== undefined && !isStroke(style.stroke)) return false;
  const object = found as Y.Map<unknown>;
  const paints = style.fill !== undefined && object.get('fill') !== style.fill;
  const outlines = style.stroke !== undefined && object.get('stroke') !== style.stroke;
  if (!paints && !outlines) return false;
  doc.transact(() => {
    if (paints) object.set('fill', style.fill as ShapeFill);
    if (outlines) object.set('stroke', style.stroke as ShapeStroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's shared label, or undefined for a missing / non-shape id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objectsMap(doc).get(id);
  if (!isShape(object)) return undefined;
  const label = object.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** How many characters a shape's label may hold. */
export const SHAPE_LABEL_LIMIT = SHAPE_LABEL_MAX_CHARS;

/**
 * Read one shape out of the document, or null when the id is gone or belongs to
 * another kind — "somebody else deleted it while I was looking at it".
 */
export function readShapeSnapshot(doc: Y.Doc, id: string): ShapeSnapshot | null {
  return readShapeObject(id, objectsMap(doc).get(id));
}

/**
 * The same read from the `Y.Map` the board already holds. This is the reader
 * `snapshotObjects` uses for a shape; it is *registered* rather than imported by
 * `board-model`, for the same reason as `registerObjectTypeModel`: no cycle.
 */
export function readShapeObject(
  id: string,
  object: Y.Map<unknown> | undefined,
): ShapeSnapshot | null {
  if (!isShape(object)) return null;
  const label = object.get('label');
  const kind = object.get('kind');
  const fill = object.get('fill');
  const stroke = object.get('stroke');
  const width = object.get('width');
  const height = object.get('height');
  const createdBy = object.get('createdBy');
  const createdAt = object.get('createdAt');
  const standard = defaultShapeSize();
  return {
    id,
    type: 'shape',
    kind: isKind(kind) ? kind : DEFAULT_SHAPE_KIND,
    x: isFiniteNumber(object.get('x')) ? (object.get('x') as number) : 0,
    y: isFiniteNumber(object.get('y')) ? (object.get('y') as number) : 0,
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    // A shape always has a box to be drawn in: numbers that are missing, or that are
    // not numbers, become the standard size rather than a shape with no size.
    width: isFiniteNumber(width) ? width : standard.width,
    height: isFiniteNumber(height) ? height : standard.height,
    fill: isFill(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStroke(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
    createdBy: typeof createdBy === 'string' ? createdBy : undefined,
    createdAt: isFiniteNumber(createdAt) ? createdAt : undefined,
  };
}

/** True for the kind that has a kind, two colours and a label. */
export const isShapeSnapshot = (object: BoardObject): object is ShapeSnapshot =>
  object.type === 'shape';

/** Every shape in the document, in draw order. */
export function shapeSnapshots(doc: Y.Doc): ShapeSnapshot[] {
  const out: ShapeSnapshot[] = [];
  objectsMap(doc).forEach((value, key) => {
    const snapshot = readShapeObject(key, value);
    if (snapshot) out.push(snapshot);
  });
  return out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
}

/**
 * The colour a shape's fill is drawn with, or `transparent` for the palette's "no
 * fill". The component asks for this rather than reading the palette itself, so that
 * the palette is a thing the model owns and a "none" fill cannot be drawn wrong.
 */
export const shapeFillCss = (fill: ShapeFill): string => SHAPE_FILL_COLORS[fill];

/** The colour a shape's outline is drawn with. */
export const shapeStrokeCss = (stroke: ShapeStroke): string => SHAPE_STROKE_COLORS[stroke];

/** Is this a kind a shape can be? The menu offers these and nothing else. */
export const isShapeKind = (kind: unknown): kind is ShapeKind =>
  (SHAPE_KINDS as readonly unknown[]).includes(kind);
